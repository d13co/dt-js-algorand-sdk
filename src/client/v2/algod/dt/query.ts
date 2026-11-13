import JSONRequest from '../../jsonrequest.js';
import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { encodeMsgpack, decodeMsgpack } from '../../../../encoding/encoding.js';
import { setSimulateTransactionsHeaders } from '../simulateTransaction.js';
import { ensureUint64 } from '../../../../utils/utils.js';
import { ApplicationStateSchema } from '../models/types.js';
import { QueryRequest, QueryRequestParams, QueryResponse } from './models.js';
import { headerValue, queryEnabled } from './errors.js';
import { EFFORT_HEADER } from './effort.js';
import {
  QUERY_STREAM_TYPE,
  QueryStreamAssembler,
  QueryStreamError,
  QueryStreamEvent,
  ServerSentEvent,
  ServerSentEventReader,
  bodyOf,
  looksLikeServerSentEvents,
  parseQueryStreamEvent,
  readAll,
  queryStreamEventsOf,
} from './queryStream.js';

/** How long a stream may take to end after its end event before it is closed. */
const QUERY_STREAM_DRAIN_MS = 1000;

/**
 * What a failure to read an answer's body is thrown as: an abort stays an
 * abort; any other failure is a cut, a truncated {@link QueryStreamError}.
 */
function readFailure(
  err: unknown,
  what: string,
  signal: AbortSignal | undefined
): unknown {
  if (signal?.aborted || (err as Error)?.name === 'AbortError') return err;
  return new QueryStreamError(
    `The ${what} was cut off before its end: ${(err as Error)?.message ?? err}`,
    undefined,
    undefined,
    err
  );
}

/** A copy of a request, with its own `calls` and `rounds` arrays. */
function copyRequest(request: QueryRequest | QueryRequestParams) {
  if (!(request instanceof QueryRequest)) return new QueryRequest(request);
  return new QueryRequest({
    program: request.program,
    clearProgram: request.clearProgram,
    globalSchema: request.globalSchema,
    localSchema: request.localSchema,
    appId: request.appId,
    sender: request.sender,
    rounds: request.rounds,
    protocol: request.protocol,
    budget: request.budget,
    calls: request.calls,
  });
}

/**
 * Read-only TEAL calls at one or more rounds (`POST /v2/query`). Requires a
 * dtalgod node with queries on; one with them disabled is thrown as a
 * `DTUnsupportedError`. See `DTAlgodClient.query`.
 *
 * The request is copied when this is made (its `calls` and `rounds` arrays
 * too, not the calls themselves) and encoded when it is sent, so the builders
 * apply. `doRaw()` returns the msgpack response body as received, without
 * decoding or checking it.
 */
export default class RunQuery extends JSONRequest<QueryResponse> {
  private request: QueryRequest;

  constructor(c: HTTPClient, request: QueryRequest | QueryRequestParams) {
    super(c);
    this.request = copyRequest(request);
    this.query.format = 'msgpack';
  }

  // eslint-disable-next-line class-methods-use-this
  path() {
    return '/v2/query';
  }

  /**
   * Query at each listed round instead of the latest one. 0 is the latest
   * round. The results are in the response's `rounds`, one per entry in this
   * order; a round that cannot be queried has an `error` there instead of
   * failing the request. The node's `QueryLimits.maxRounds` limits how many
   * entries a request may list, duplicates included, and its `maxTotalCalls`
   * limits the calls times the entries. An empty list sends no rounds,
   * clearing any the request had.
   *
   * @param rounds - The rounds to query at.
   * @category body
   */
  rounds(rounds: (number | bigint)[]) {
    this.request.rounds =
      rounds.length > 0 ? rounds.map(ensureUint64) : undefined;
    return this;
  }

  /**
   * The protocol the block after each queried round runs: `latest` (the
   * default, unlike simulate, which runs the round's own), a consensus
   * version or `vNN` name of a later protocol, or `round` for the protocol
   * the chain really ran. `future` needs the node's
   * developer API. Each round result's `protocolOverride` says how it
   * applied.
   *
   * @param protocol - The protocol. An empty string sends none.
   * @category body
   */
  protocol(protocol: string) {
    this.request.protocol = protocol === '' ? undefined : protocol;
    return this;
  }

  /** How many round results the response must have. */
  private expectedRounds(): number {
    return Math.max(1, this.request.rounds?.length ?? 0);
  }

  /**
   * Why the request is invalid in a way the node would reject as a whole, or
   * undefined: no calls, neither or both of a non-empty `program` and a
   * non-zero `appId`, or with `appId`, a non-empty `clearProgram` or a
   * non-zero `globalSchema` / `localSchema` (all-zero schemas are accepted,
   * as the node does). Checked before sending, for a clearer error than the
   * node's. The node's limits are not checked here.
   */
  private invalidReason(): string | undefined {
    const { program, clearProgram, globalSchema, localSchema, appId, calls } =
      this.request;
    if (calls.length === 0) return 'A query needs at least one call';
    const hasProgram = program !== undefined && program.length > 0;
    const hasApp = appId !== undefined && appId !== BigInt(0);
    if (hasProgram === hasApp) {
      return 'A query needs exactly one of program and appId';
    }
    const nonZero = (schema?: ApplicationStateSchema) =>
      schema !== undefined &&
      (schema.numUint !== 0 || schema.numByteSlice !== 0);
    if (
      hasApp &&
      ((clearProgram !== undefined && clearProgram.length > 0) ||
        nonZero(globalSchema) ||
        nonZero(localSchema))
    ) {
      return 'clearProgram, globalSchema and localSchema need program, not appId';
    }
    return undefined;
  }

  protected executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    const invalid = this.invalidReason();
    if (invalid !== undefined) return Promise.reject(new Error(invalid));
    // Encoded here, not in the constructor, so that the builders apply.
    return queryEnabled(
      this.c.post({
        relativePath: this.path(),
        data: encodeMsgpack(this.request),
        query: this.query,
        requestHeaders: setSimulateTransactionsHeaders(headers),
        customOptions,
      })
    );
  }

  /**
   * Runs the query with its answer streamed: `onEvent` gets each event as the
   * node sends it (see {@link QueryStreamEvent}), each call's logs as the
   * called app makes them, and the promise resolves to the same response as
   * `do()`, with the same checks, once the stream ends.
   *
   * The node streams when its capabilities' `query.stream` lists `"sse"`. A
   * node that doesn't, or an HTTP client without `postStream` (a wallet's),
   * answers in full; `onEvent` then gets the events that answer would have
   * streamed, all at once, before the promise resolves. Code written for the
   * stream thus works on every node.
   *
   * Events are final as they come, but for these:
   * - a `round` event with an `error` voids the events of that round's calls
   *   (the node failed to read the round; its result has no calls);
   * - a stream that ends early rejects the promise with a
   *   {@link QueryStreamError}: the node stopped it (`status` 400 over
   *   `maxResponseBytes`, which `isQueryResponseTooLarge` recognizes, 504 at
   *   the time limit), or it was cut off (`truncated`). The events that came
   *   before it are what the calls did up to then. A full answer cut off
   *   while it is read is a `truncated` {@link QueryStreamError} too.
   *
   * The rounds run at once, so their events interleave: the events of one
   * call come in order, but a round's `round` event may come before or after
   * those of other rounds, in the order the rounds end.
   *
   * Errors before the stream starts (an invalid request, a busy node) are
   * thrown as by `do()`, and the HTTP client's retries apply to them only. An
   * exception `onEvent` throws stops the request and rejects the promise with
   * it. Abort with a `signal` in `customOptions`.
   *
   * @param onEvent - Called with each event, in order.
   * @param headers - Additional headers to send in the request. Optional.
   * @param customOptions - Additional options to pass to the underlying
   *   BaseHTTPClient, such as a `signal`. Optional.
   * @returns The response, as `do()` returns it.
   *
   * #### Example
   * ```typescript
   * const response = await algodClient
   *   .query({ program, rounds: [r1, r2], calls })
   *   .stream((event) => {
   *     if (event.type === 'logs') render(event.round, event.call, event.index, event.logs);
   *   });
   * ```
   */
  async stream(
    onEvent?: (event: QueryStreamEvent) => void,
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<QueryResponse> {
    const invalid = this.invalidReason();
    if (invalid !== undefined) throw new Error(invalid);
    const emit = onEvent ?? (() => {});
    if (!this.c.canStream()) {
      return this.replay(
        await this.executeRequest(headers, customOptions),
        emit
      );
    }
    const requestHeaders = { ...setSimulateTransactionsHeaders(headers) };
    if (
      !Object.keys(requestHeaders).some((k) => k.toLowerCase() === 'accept')
    ) {
      // A node without streams answers as format=msgpack says
      requestHeaders.Accept = `${QUERY_STREAM_TYPE}, application/msgpack;q=0.5`;
    }
    const res = await queryEnabled(
      this.c.postStream({
        relativePath: this.path(),
        data: encodeMsgpack(this.request),
        query: this.query,
        requestHeaders,
        customOptions,
      })
    );
    const type = (headerValue(res.headers, 'content-type') ?? '').toLowerCase();
    const signal = customOptions?.signal as AbortSignal | undefined;
    let { body } = res;
    if (!type.startsWith(QUERY_STREAM_TYPE)) {
      // A full answer, from a node without streams; or a stream whose type a
      // proxy dropped or changed, which the body itself shows
      let bytes: Uint8Array;
      try {
        bytes = await readAll(body);
      } catch (err) {
        throw readFailure(err, 'query answer', signal);
      }
      if (type.includes('msgpack') || !looksLikeServerSentEvents(bytes)) {
        return this.replay(
          new HTTPClientResponse({
            body: bytes,
            format: 'application/msgpack',
            headers: res.headers,
            status: res.status,
            ok: true,
          }),
          emit
        );
      }
      body = bodyOf(bytes);
    }
    const reader = new ServerSentEventReader(body);
    const assembler = new QueryStreamAssembler(this.request.calls.length);
    let failed = false;
    try {
      while (!assembler.ended) {
        let sse: ServerSentEvent | undefined;
        try {
          // eslint-disable-next-line no-await-in-loop
          sse = await reader.next();
        } catch (err) {
          throw readFailure(err, 'query stream', signal);
        }
        if (!sse) break;
        const event = parseQueryStreamEvent(sse);
        if (event) {
          assembler.add(event);
          emit(event);
        }
      }
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      // After the end event the body ends too: read it to its end, so the
      // connection can be reused. On an error, or an exception of onEvent
      // (on the end event too), close the connection.
      if (assembler.ended && !failed) {
        await reader.drain(QUERY_STREAM_DRAIN_MS);
      } else {
        await reader.cancel();
      }
    }
    return this.check(assembler.response());
  }

  /** Decodes a full answer, reports its events, and returns it. */
  private replay(
    response: HTTPClientResponse,
    emit: (event: QueryStreamEvent) => void
  ): QueryResponse {
    const data = this.prepare(response);
    const effort = headerValue(response.headers, EFFORT_HEADER);
    for (const event of queryStreamEventsOf(data, effort)) emit(event);
    return data;
  }

  /**
   * Decodes the response and checks that it has one round result per
   * requested round, each for the round asked for (any round for a 0 entry,
   * which the node resolves), and one call result per call in each round
   * result without an `error`. A mismatch is a node bug, thrown as an
   * `Error`.
   */
  prepare(response: HTTPClientResponse): QueryResponse {
    return this.check(decodeMsgpack(response.body, QueryResponse));
  }

  /** The checks of `prepare` on a decoded response, which it returns. */
  private check(data: QueryResponse): QueryResponse {
    const expected = this.expectedRounds();
    if (data.rounds.length !== expected) {
      throw new Error(
        `Queried ${expected} rounds but the node answered with ${data.rounds.length} round results`
      );
    }
    const { rounds, calls } = this.request;
    data.rounds.forEach((result, i) => {
      const requested = rounds?.[i];
      if (
        requested !== undefined &&
        requested !== BigInt(0) &&
        result.round !== requested
      ) {
        throw new Error(
          `Round result ${i} is for round ${result.round}, not the round asked for, ${requested}`
        );
      }
      if (result.error === undefined && result.calls.length !== calls.length) {
        throw new Error(
          `Queried ${calls.length} calls but the node answered with ${result.calls.length} call results in round result ${i}`
        );
      }
    });
    return data;
  }
}
