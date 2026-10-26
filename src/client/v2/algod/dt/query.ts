import JSONRequest from '../../jsonrequest.js';
import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { encodeMsgpack, decodeMsgpack } from '../../../../encoding/encoding.js';
import { setSimulateTransactionsHeaders } from '../simulateTransaction.js';
import { ensureUint64 } from '../../../../utils/utils.js';
import { ApplicationStateSchema } from '../models/types.js';
import { QueryRequest, QueryRequestParams, QueryResponse } from './models.js';
import { queryWithFeatures } from './errors.js';

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
 * node built from the time-travel fork with queries on; a node without them is
 * thrown as a `DTUnsupportedError`. See `DTAlgodClient.query`.
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
   * entries a request may list, duplicates included. An empty list sends no
   * rounds, clearing any the request had.
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
   * The protocol the block after each queried round runs, as in simulate:
   * `latest` (the default, unlike simulate, which defaults to the round's
   * own), a consensus version or `vNN` name of a later protocol, or `round`
   * for the protocol the chain really ran. `future` needs the node's
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
    return queryWithFeatures(
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
   * Decodes the response and checks that it has one round result per
   * requested round, each for the round asked for (any round for a 0 entry,
   * which the node resolves), and one call result per call in each round
   * result without an `error`. A mismatch is a node bug, thrown as an
   * `Error`.
   */
  prepare(response: HTTPClientResponse): QueryResponse {
    const data = decodeMsgpack(response.body, QueryResponse);
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
