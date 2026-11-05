import { HTTPClientResponse } from '../../../client.js';
import { SimulateTransactionGroupResult } from '../models/types.js';

/**
 * Thrown when a dtalgod node does not have an optional feature a request
 * needs, or when the node is not a dtalgod node:
 * - time travel is off (`EnableTimeTravel`): reads at a past round, the
 *   `/versions` endpoints and `getAssetHolders`;
 * - the node answered a read at a round without `X-Algod-TT-Round`, or
 *   marked with another round: it ignored `round` (stock algod, perhaps
 *   behind a load balancer that mixes nodes);
 * - the asset holders index is off (`TimeTravelHoldersIndex`):
 *   `getAssetHolders`;
 * - queries are disabled (`MaxAPIQueryCalls` 0): `query`;
 * - the node has no capabilities endpoint, which every dtalgod node has:
 *   it is stock algod (`getCapabilities`).
 */
export class DTUnsupportedError extends Error {
  /** The round that was asked for, when the error comes from a read at a round. */
  public requestedRound?: bigint;

  /** The HTTP error the node answered with, if any. */
  public cause?: unknown;

  constructor(
    message: string,
    { requestedRound, cause }: { requestedRound?: bigint; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'DTUnsupportedError';
    this.requestedRound = requestedRound;
    this.cause = cause;
  }
}

/** The `message` of a JSON error body, or undefined. */
function bodyMessage(body: unknown): string | undefined {
  if (!(body instanceof Uint8Array) || body.length === 0) return undefined;
  try {
    const message = JSON.parse(new TextDecoder().decode(body))?.message;
    return typeof message === 'string' ? message : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The status and the text of an error thrown by HTTPClient, or by a
 * BaseHTTPClient (status on `response`, the body not yet decoded to `text`).
 */
export function describe(err: unknown) {
  const e = err as
    | {
        status?: number;
        message?: string;
        response?: { status?: number; text?: string; body?: unknown };
      }
    | undefined;
  const responseText =
    e?.response?.text ?? bodyMessage(e?.response?.body) ?? '';
  return {
    status: e?.status ?? e?.response?.status,
    text: `${e?.message ?? ''} ${responseText}`,
  };
}

/**
 * Whether an error thrown by HTTPClient for a read with `round` means the node
 * cannot read that past round: a 400 with either
 * - `looking up past rounds requires EnableTimeTravel`, from a node with time
 *   travel off, or
 * - `given round is no longer available`, from the boxes list of a node with
 *   time travel off, which keeps only its last few rounds.
 */
export function isPastRoundUnsupported(err: unknown) {
  const { status, text } = describe(err);
  return (
    status === 400 &&
    /requires EnableTimeTravel|given round is no longer available/.test(text)
  );
}

/**
 * The response header, lowercased, with which a dtalgod node marks an answer
 * given as of the round a read asked for with `round`: the 200, a 404 (not
 * found at that round) and the other errors of the lookup at that round. Its
 * value is the round. A refusal of the round does not carry it, and neither
 * does an answer from a node that ignored `round`, such as algod without time
 * travel, which answers as of its latest round.
 */
export const TT_ROUND_HEADER = 'x-algod-tt-round';

/**
 * The value of a response header, matched without regard to case.
 *
 * algosdk 3.9.0 and earlier key response headers by value instead of by name
 * (`{ "5": "x-algod-tt-round" }`), so headers from the HTTP client of such a
 * copy of algosdk (see `DTAlgodClient.from`) are read that way when the name is
 * not a key.
 *
 * @param headers - The response headers.
 * @param name - The header's name, lowercased.
 */
export function headerValue(
  headers: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const keys = Object.keys(headers);
  const key = keys.find((k) => k.toLowerCase() === name);
  if (key !== undefined) return headers[key];
  return keys.find((k) => String(headers[k]).toLowerCase() === name);
}

/**
 * Throws a {@link DTUnsupportedError} unless the headers mark an answer given
 * as of round `requested` ({@link TT_ROUND_HEADER}).
 */
function checkMarked(
  requested: bigint,
  headers: Record<string, string> | undefined,
  cause?: unknown
) {
  const value = headerValue(headers, TT_ROUND_HEADER)?.trim();
  if (value === undefined) {
    throw new DTUnsupportedError(
      `The node answered a read at round ${requested} without ${TT_ROUND_HEADER}, so it ignored round and answered as of its latest round: it is not a dtalgod node with time travel (EnableTimeTravel), or a proxy dropped the header`,
      { requestedRound: requested, cause }
    );
  }
  if (!/^\d+$/.test(value) || BigInt(value) !== requested) {
    throw new DTUnsupportedError(
      `The node marked its answer to a read at round ${requested} as round ${value} (${TT_ROUND_HEADER})`,
      { requestedRound: requested, cause }
    );
  }
}

/**
 * Runs a read, turning a refusal to read a past round into a
 * {@link DTUnsupportedError}. Other errors pass through unchanged.
 * @param requested - The round that was asked for, if any.
 * @param request - The read.
 */
export async function refusalAtRound(
  requested: bigint | undefined,
  request: Promise<HTTPClientResponse>
) {
  try {
    return await request;
  } catch (err) {
    if (requested !== undefined && isPastRoundUnsupported(err)) {
      throw new DTUnsupportedError(
        `The node cannot read round ${requested}: it has time travel off (EnableTimeTravel)`,
        { requestedRound: requested, cause: err }
      );
    }
    throw err;
  }
}

/**
 * Runs a read and, when it asked for a round, checks that the node answered
 * as of that round:
 * - a refusal to read a past round is a {@link DTUnsupportedError};
 * - a response or a 404 without {@link TT_ROUND_HEADER}, or marked with
 *   another round, is a {@link DTUnsupportedError}: the node ignored `round`
 *   (stock algod).
 *
 * Other errors pass through unchanged.
 * @param requested - The round that was asked for, if any.
 * @param request - The read.
 */
export async function readAtRound(
  requested: bigint | undefined,
  request: Promise<HTTPClientResponse>
) {
  if (requested === undefined) return request;
  let response: HTTPClientResponse;
  try {
    response = await refusalAtRound(requested, request);
  } catch (err) {
    if (!(err instanceof DTUnsupportedError) && describe(err).status === 404) {
      checkMarked(
        requested,
        (err as { response?: { headers?: Record<string, string> } }).response
          ?.headers,
        err
      );
    }
    throw err;
  }
  checkMarked(requested, response.headers);
  return response;
}

/**
 * Why a transaction group has no usable simulation result:
 * - `group`: the group failed (`failureMessage`, with `failedAt` when the node
 *   blamed one transaction);
 * - `not-simulated`: the group was skipped after an earlier group failed a
 *   post-evaluation check;
 * - `missing`: the response has no result for the group.
 */
export type SimulateGroupErrorKind = 'group' | 'not-simulated' | 'missing';

/**
 * The failure of one transaction group of a simulate response, from
 * `DTSimulateResponse.groupResult`.
 */
export class SimulateGroupError extends Error {
  /** Why the group has no usable result. */
  public kind: SimulateGroupErrorKind;

  /** The index of the group in the request. */
  public groupIndex: number;

  /** The round the simulation ran after (the response's `lastRound`). */
  public round: bigint;

  /** The group's `failureMessage`. Undefined for `missing`. */
  public failureMessage?: string;

  /** For `group`: the path of the transaction that failed, if the node gave one. */
  public failedAt?: number[];

  /**
   * The group's result, when the node returned one (`group` and
   * `not-simulated`): it holds the transactions that ran before the failure,
   * with their logs and budget.
   */
  public result?: SimulateTransactionGroupResult;

  constructor({
    kind,
    groupIndex,
    round,
    failureMessage,
    failedAt,
    result,
  }: {
    kind: SimulateGroupErrorKind;
    groupIndex: number;
    round: bigint;
    failureMessage?: string;
    failedAt?: number[];
    result?: SimulateTransactionGroupResult;
  }) {
    const where = `group ${groupIndex} at round ${round}`;
    let message: string;
    switch (kind) {
      case 'not-simulated':
        message = `Did not simulate ${where}: ${failureMessage}`;
        break;
      case 'missing':
        message = `The response has no result for ${where}`;
        break;
      default:
        message = `Simulating ${where} failed${failedAt ? ` at transaction ${failedAt.join('.')}` : ''}: ${failureMessage}`;
    }
    super(message);
    this.name = 'SimulateGroupError';
    this.kind = kind;
    this.groupIndex = groupIndex;
    this.round = round;
    this.failureMessage = failureMessage;
    this.failedAt = failedAt;
    this.result = result;
  }
}

/**
 * The default of the node's `MaxAPISimulateGroups`: the most transaction
 * groups a simulate request may hold. `capabilities()` reports the node's
 * own value as `simulate.maxTxnGroups`.
 */
export const DEFAULT_MAX_SIMULATE_GROUPS = 16;

/**
 * The most bytes a `POST /v2/query` request body may have: a fixed limit of
 * the node, the same as simulate's, that `capabilities()` does not report.
 * A planning hint for splitting requests (`encodeMsgpack(request).length`);
 * the client does not check it.
 */
export const MAX_QUERY_REQUEST_BYTES = 1_000_000;

/**
 * What each log counts toward the node's `QueryLimits.maxResponseBytes`
 * besides its own length.
 */
export const QUERY_LOG_OVERHEAD_BYTES = 48;

/**
 * Runs a query request, turning a node with queries disabled
 * (`MaxAPIQueryCalls` 0) into a {@link DTUnsupportedError}. Other errors pass
 * through unchanged.
 * @param request - The request.
 */
export async function queryEnabled(request: Promise<HTTPClientResponse>) {
  try {
    return await request;
  } catch (err) {
    const { status, text } = describe(err);
    if (status === 400 && /query is disabled on this node/.test(text)) {
      throw new DTUnsupportedError(
        'The node has queries disabled (MaxAPIQueryCalls is 0)',
        { cause: err }
      );
    }
    throw err;
  }
}

/**
 * Whether an error thrown by a query request means its results are over the
 * node's `QueryLimits.maxResponseBytes`: a 400 saying
 * `query response too large`. Split the request (fewer calls or rounds) and
 * retry.
 *
 * #### Example
 * ```typescript
 * try {
 *   return await algodClient.query(request).do();
 * } catch (err) {
 *   if (!algosdk.isQueryResponseTooLarge(err)) throw err;
 *   // send the calls in two halves
 * }
 * ```
 */
export function isQueryResponseTooLarge(err: unknown): boolean {
  const { status, text } = describe(err);
  return status === 400 && /query response too large/.test(text);
}

/**
 * Whether an error is the node's 503 "the node is busy: try again later or on
 * another node", from its limit on concurrent simulate, query, versions and
 * delta requests, or "every slot for re-evaluating old rounds is in use", from
 * `getLedgerStateDelta` for a round older than the node's in-memory deltas.
 * Retry after a moment (`retryAfterSeconds(err)`, 1 when a proxy dropped the
 * header), or on another node. It is matched by status and message, not
 * `Retry-After`.
 *
 * @param err - The error thrown by a request.
 */
export function isNodeBusy(err: unknown): boolean {
  const { status, text } = describe(err);
  return (
    status === 503 &&
    /node is busy|every slot for re-evaluating old rounds is in use/.test(text)
  );
}

/**
 * The seconds to wait that an HTTP error's `Retry-After` header says, given
 * as seconds or as an HTTP date (then rounded up, and 0 if already past), or
 * undefined when it has none or it doesn't parse. The node exposes it to
 * cross-origin scripts, but a proxy in front of it may drop it, so have a
 * default.
 *
 * @param err - The error thrown by a request.
 */
export function retryAfterSeconds(err: unknown): number | undefined {
  const value = headerValue(
    (err as { response?: { headers?: Record<string, string> } })?.response
      ?.headers,
    'retry-after'
  )?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/**
 * Whether an error is the node's 504 "the request reached the node's time
 * limit": the request ran longer than the node allows
 * (`RestWriteTimeoutSeconds`, `timeLimitSeconds` in `capabilities()`).
 * Retrying the same request will fail again: split it (fewer groups, calls,
 * rounds, or a shorter versions page) instead.
 *
 * @param err - The error thrown by a request.
 */
export function isTimeLimitExceeded(err: unknown): boolean {
  return describe(err).status === 504;
}

/**
 * Whether an error is a versions request with more objects than the node
 * merges: 400 "one round of boxes is too large" (boxes versions with
 * `rounds`: one requested round holds more boxes than a page may) or "too
 * many objects to merge" (account versions, with or without `rounds`, or
 * boxes versions with `rounds`). Narrow the request: `exclude()` or the
 * per-resource versions on an account, a box `prefix()`, or reads at that
 * round instead.
 *
 * @param err - The error thrown by a request.
 */
export function isRoundTooLarge(err: unknown): boolean {
  const { status, text } = describe(err);
  return (
    status === 400 &&
    /one round of boxes is too large|too many objects to merge/.test(text)
  );
}

/**
 * Whether an error is a 503 that says the node cannot serve that history now,
 * which retrying soon won't fix:
 * - "the box index is incomplete" (boxes versions over rounds before the
 *   node's box index);
 * - "the asset holders index is not complete" (`getAssetHolders` while the
 *   index is built);
 * - "the time travel history is not served" (a node still catching up its
 *   history).
 *
 * Fall back to reads at a round, another node or an indexer, rather than
 * retrying as for {@link isNodeBusy}.
 *
 * @param err - The error thrown by a request.
 */
export function isHistoryUnavailable(err: unknown): boolean {
  const { status, text } = describe(err);
  return (
    status === 503 &&
    /box index is incomplete|asset holders index is not complete|history is not served/.test(
      text
    )
  );
}

/**
 * Whether an error is a 429 Too Many Requests: dtalgod's limit on requests in
 * flight (`RestConnectionsSoftLimit`), or a proxy's rate limit. dtalgod's 429
 * has an empty body and `Retry-After: 1`; stock algod's has no `Retry-After`.
 * Retry after `retryAfterSeconds(err) ?? 1` seconds, or on another node.
 *
 * @param err - The error thrown by a request.
 */
export function isTooManyRequests(err: unknown): boolean {
  return describe(err).status === 429;
}

/**
 * The network error codes {@link isNetworkError} retries by default: Node's
 * socket and DNS errors, and undici's (Node's fetch) connection errors.
 */
export const DEFAULT_NETWORK_ERROR_CODES: readonly string[] = Object.freeze([
  'ETIMEDOUT',
  'ECONNRESET',
  'EADDRINUSE',
  'ECONNREFUSED',
  'EPIPE',
  'ENOTFOUND',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'EPROTO',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

/**
 * The messages of the `TypeError` fetch throws when no response arrived:
 * Chrome, Firefox, Safari and Node. Browsers give no reason: the node may be
 * down, have refused the connection, or answered without CORS headers (such
 * as a 429 from dtalgod before v5.0.5-dt5).
 */
const FETCH_FAILED =
  /^(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|fetch failed)$/;

/**
 * The code of a network error: on the error (Node's http) or on its `cause`
 * (Node's fetch: `TypeError('fetch failed')` with `cause.code`).
 */
export function networkErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Whether an error is a request that got no HTTP response: a network error
 * with one of `codes` (on the error or on its `cause`), or, without a code, a
 * fetch `TypeError` that failed to reach the node ("Failed to fetch" and the
 * like). An abort, `AbortSignal.timeout()` included (`AbortError`,
 * `TimeoutError`), is not one, and neither is any other `TypeError`.
 *
 * @param err - The error thrown by a request.
 * @param codes - The network error codes that count.
 */
export function isNetworkError(
  err: unknown,
  codes: readonly string[] = DEFAULT_NETWORK_ERROR_CODES
): boolean {
  const e = err as { name?: unknown; message?: unknown } | undefined;
  if (!e || typeof e !== 'object') return false;
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return false;
  if (describe(err).status !== undefined) return false;
  const code = networkErrorCode(err);
  if (code !== undefined) return codes.includes(code);
  return (
    e.name === 'TypeError' &&
    typeof e.message === 'string' &&
    FETCH_FAILED.test(e.message)
  );
}
