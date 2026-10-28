import { HTTPClientResponse } from '../../../client.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import IntDecoding from '../../../../types/intDecoding.js';
import { SimulateTransactionGroupResult } from '../models/types.js';

/**
 * Thrown when a node cannot answer a time-travel request: it has no
 * `/versions` endpoints, it rejected a past round, it answered a read for a
 * round other than the one asked for, which is what stock algod does when it
 * ignores `round`, or it rejected the fork's simulate features (several
 * transaction groups, `parallel-groups`, `rounds`, the validity window modes,
 * `protocol`) or answered without applying them (`rounds` without one result
 * per listed round, a validity window mode not echoed, `protocol` without a
 * `protocol-override`), or it has no simulate limits endpoint
 * (`getSimulateLimits`), or it has no query endpoint (`query`: a 404 from
 * stock algod or an older fork build) or has queries disabled (a 400 saying
 * so, from a node with `MaxAPIQueryCalls` 0).
 */
export class DTUnsupportedError extends Error {
  /** The round that was asked for, when the error comes from a round check. */
  public requestedRound?: bigint;

  /** The round the node answered for, when it reported one. */
  public returnedRound?: bigint;

  /** The HTTP error the node answered with, if any. */
  public cause?: unknown;

  constructor(
    message: string,
    {
      requestedRound,
      returnedRound,
      cause,
    }: { requestedRound?: bigint; returnedRound?: bigint; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'DTUnsupportedError';
    this.requestedRound = requestedRound;
    this.returnedRound = returnedRound;
    this.cause = cause;
  }
}

/**
 * Whether a JSON response has `key` at its top level. Decoding into a model
 * fills in 0 for a missing round, so a returned round of 0 needs this.
 */
function hasKey(response: HTTPClientResponse, key: string) {
  const body = response.parseBodyAsJSON({ intDecoding: IntDecoding.BIGINT });
  return typeof body === 'object' && body !== null && key in body;
}

/**
 * Throws a {@link DTUnsupportedError} if a round was requested and the
 * response is for a different round (or reports none).
 * @param requested - The round that was asked for, if any.
 * @param returned - The round reported by the decoded response.
 * @param response - The response, to tell a round of 0 from a missing one.
 * @param key - The response's round key: `round`, or `current_round`.
 */
export function checkRound(
  requested: bigint | undefined,
  returned: number | bigint | undefined,
  response: HTTPClientResponse,
  key = 'round'
) {
  if (requested === undefined) return;
  let returnedRound =
    returned === undefined ? undefined : ensureBigInt(returned);
  if (returnedRound === BigInt(0) && !hasKey(response, key)) {
    returnedRound = undefined;
  }
  if (returnedRound !== requested) {
    throw new DTUnsupportedError(
      `Asked for round ${requested} but the node answered for ${returnedRound ?? 'an unknown round'}; it does not support reads at past rounds`,
      { requestedRound: requested, returnedRound }
    );
  }
}

/** The status and the text of an error thrown by HTTPClient. */
export function describe(err: unknown) {
  const e = err as
    | { status?: number; message?: string; response?: { text?: string } }
    | undefined;
  return {
    status: e?.status,
    text: `${e?.message ?? ''} ${e?.response?.text ?? ''}`,
  };
}

/**
 * Whether an error thrown by HTTPClient for a `/versions` request means the
 * node does not have them. That is a 404 (the routes are only registered with
 * `EnableTimeTravel`), or a 400 where:
 * - stock algod's router hands `{id}/versions` to the plain lookup as the ID
 *   (`/v2/assets/{id}`, `/v2/accounts/{address}/assets/{id}`,
 *   `.../applications/{id}`), which rejects it, or
 * - the node's ledger has no history (`versions require EnableTimeTravel`).
 */
export function isMissingVersionsRoute(err: unknown) {
  const { status, text } = describe(err);
  if (status === 404) return true;
  if (status !== 400) return false;
  // Only the router's ID binding error: a node with time travel rejects a bad
  // `next` with the same `parsing "...": invalid syntax` tail.
  return (
    /Invalid format for parameter (?:asset-id|application-id): .*parsing \\?"[^"\\]*\/versions\\?": invalid syntax/.test(
      text
    ) || /versions require EnableTimeTravel/.test(text)
  );
}

/**
 * Whether an error thrown by HTTPClient for a read with `round` means the node
 * cannot read past rounds. That is a 400 with either:
 * - `looking up past rounds requires EnableTimeTravel`, from a time-travel
 *   build with it off, or
 * - `given round is no longer available`, from a node that keeps only its last
 *   few rounds.
 */
export function isPastRoundUnsupported(err: unknown) {
  const { status, text } = describe(err);
  return (
    status === 400 &&
    /requires EnableTimeTravel|given round is no longer available/.test(text)
  );
}

/**
 * Runs a read, turning a refusal to read a past round into a
 * {@link DTUnsupportedError}.
 * @param requested - The round that was asked for, if any.
 * @param request - The read.
 */
export async function readAtRound(
  requested: bigint | undefined,
  request: Promise<HTTPClientResponse>
) {
  try {
    return await request;
  } catch (err) {
    if (requested !== undefined && isPastRoundUnsupported(err)) {
      throw new DTUnsupportedError(
        `The node cannot read round ${requested}; it does not support reads at past rounds`,
        { requestedRound: requested, cause: err }
      );
    }
    throw err;
  }
}

/** The fork features a simulate request uses. */
export interface SimulateFeatures {
  /** How many transaction groups it holds. */
  groups: number;
  /** The names of the fork fields it sets, such as `parallel-groups`. */
  fields: string[];
}

/**
 * Why a node that rejected a simulate request does not have the fork features
 * the request uses, or undefined if the error is about something else:
 * - stock algod simulates only one group, and says
 *   `expected 1 transaction group, got N`;
 * - stock algod decodes the body strictly, so a field it does not know is a
 *   400. It then retries the body as JSON and reports that failure, not the
 *   unknown field:
 *   `only encoded map or array can be decoded into a struct`.
 *   The SDK always sends well-formed msgpack, so that failure on a request
 *   with fork fields most likely means the node does not know them (an older
 *   fork node that knows only some of them answers the same way).
 */
export function simulateUnsupportedReason(
  err: unknown,
  { groups, fields }: SimulateFeatures
) {
  const { status, text } = describe(err);
  if (status !== 400) return undefined;
  if (groups > 1 && /expected 1 transaction group, got/.test(text)) {
    return `it simulates only one transaction group per request, and this request has ${groups}`;
  }
  if (
    fields.length > 0 &&
    /only encoded map or array can be decoded into a struct|no matching struct field/.test(
      text
    )
  ) {
    return `it could not decode the request, which sets ${fields.join(', ')}; it probably does not know them`;
  }
  return undefined;
}

/**
 * Runs a simulate request, turning a rejection of the fork features it uses
 * into a {@link DTUnsupportedError}.
 * @param features - What the request uses.
 * @param request - The request.
 */
export async function simulateWithFeatures(
  features: SimulateFeatures,
  request: Promise<HTTPClientResponse>
) {
  try {
    return await request;
  } catch (err) {
    const reason = simulateUnsupportedReason(err, features);
    if (reason !== undefined) {
      throw new DTUnsupportedError(
        `The node does not support this simulate request: ${reason}`,
        { cause: err }
      );
    }
    throw err;
  }
}

/**
 * Why a transaction group has no usable simulation result:
 * - `round`: the request could not be simulated at that round at all (the
 *   round result's `error`);
 * - `group`: the group failed (`failureMessage`, with `failedAt` when the node
 *   blamed one transaction);
 * - `not-simulated`: the group was skipped after an earlier group failed a
 *   post-evaluation check;
 * - `missing`: the response has no result for the group.
 */
export type SimulateGroupErrorKind =
  | 'round'
  | 'group'
  | 'not-simulated'
  | 'missing';

/**
 * The failure of one transaction group at one round of a simulate response,
 * from `DTSimulateResponse.groupResult`.
 */
export class SimulateGroupError extends Error {
  /** Why the group has no usable result. */
  public kind: SimulateGroupErrorKind;

  /** The index into the response's `roundResults`, or 0 without rounds. */
  public roundIndex: number;

  /** The index of the group in the request. */
  public groupIndex: number;

  /** The round the simulation ran after (the result's `lastRound`). */
  public round: bigint;

  /**
   * The node's message: the round's `error`, or the group's
   * `failureMessage`. Undefined for `missing`.
   */
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
    roundIndex,
    groupIndex,
    round,
    failureMessage,
    failedAt,
    result,
  }: {
    kind: SimulateGroupErrorKind;
    roundIndex: number;
    groupIndex: number;
    round: bigint;
    failureMessage?: string;
    failedAt?: number[];
    result?: SimulateTransactionGroupResult;
  }) {
    const where = `group ${groupIndex} at round ${round}`;
    let message: string;
    switch (kind) {
      case 'round':
        message = `Could not simulate ${where}: ${failureMessage}`;
        break;
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
    this.roundIndex = roundIndex;
    this.groupIndex = groupIndex;
    this.round = round;
    this.failureMessage = failureMessage;
    this.failedAt = failedAt;
    this.result = result;
  }
}

/**
 * The most bytes a `POST /v2/query` request body may have: a fixed limit of
 * the node, the same as simulate's, that `simulateLimits()` does not report.
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
 * Runs a query request, turning a node without queries into a
 * {@link DTUnsupportedError}: a 404 (stock algod, or a fork build without
 * `POST /v2/query`), or a 400 saying queries are disabled. Other errors pass
 * through unchanged.
 * @param request - The request.
 */
export async function queryWithFeatures(request: Promise<HTTPClientResponse>) {
  try {
    return await request;
  } catch (err) {
    const { status, text } = describe(err);
    if (status === 404) {
      throw new DTUnsupportedError(
        'The node has no query endpoint; it is stock algod or a fork build without POST /v2/query',
        { cause: err }
      );
    }
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
 * delta requests. Retry after a moment (`retryAfterSeconds(err)`, 1 when the
 * header can't be read, as in browsers on a cross-origin request), or on
 * another node. It is matched by status and message, not `Retry-After`.
 *
 * @param err - The error thrown by a request.
 */
export function isNodeBusy(err: unknown): boolean {
  const { status, text } = describe(err);
  return status === 503 && /node is busy/.test(text);
}

/**
 * The seconds to wait that an HTTP error's `Retry-After` header says, given
 * as seconds or as an HTTP date (then rounded up, and 0 if already past), or
 * undefined when it has none or it doesn't parse. Browsers can't read the
 * header on a cross-origin request until the node exposes it, so have a
 * default.
 *
 * @param err - The error thrown by a request.
 */
export function retryAfterSeconds(err: unknown): number | undefined {
  const headers = (err as { response?: { headers?: Record<string, string> } })
    ?.response?.headers;
  if (!headers) return undefined;
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === 'retry-after'
  );
  const value = key === undefined ? undefined : headers[key]?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/**
 * Whether an error is the node's 504 "the request reached the node's time
 * limit": the request ran longer than the node allows
 * (`RestWriteTimeoutSeconds`, `timeLimitSeconds` in `simulateLimits()`).
 * Retrying the same request will fail again: split it (fewer groups, calls,
 * rounds, or a shorter versions page) instead.
 *
 * @param err - The error thrown by a request.
 */
export function isTimeLimitExceeded(err: unknown): boolean {
  return describe(err).status === 504;
}

/**
 * Whether an error is a versions request with `rounds` that one round could
 * not answer: 400 "too many boxes at one round" (boxes versions: one
 * requested round holds more boxes than a page may) or "too many objects to
 * merge" (more objects than the node merges, on the boxes or account
 * endpoints). Narrow the request: a box `prefix()`, fewer objects, or reads
 * at that round instead.
 *
 * @param err - The error thrown by a request.
 */
export function isRoundTooLarge(err: unknown): boolean {
  const { status, text } = describe(err);
  return (
    status === 400 &&
    /too many boxes at one round|too many objects to merge/.test(text)
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
