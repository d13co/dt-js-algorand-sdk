import JSONRequest from '../../jsonrequest.js';
import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeMsgpack } from '../../../../encoding/encoding.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import { describe, DTUnsupportedError } from './errors.js';
import { TxnStateChangesResponse } from './models.js';

/** A transaction ID: 52 characters of unpadded base32. */
const TXID = /^[A-Z2-7]{52}$/;

/** The txid, or throws if it is not one (a comma would split the list). */
function checkTxid(txid: string): string {
  if (!TXID.test(txid)) {
    throw new Error(`Not a transaction ID: ${JSON.stringify(txid)}`);
  }
  return txid;
}

/**
 * Why a node that answered a state changes request with a 404 does not serve
 * the endpoint, or undefined if the 404 is the handler's own (a round whose
 * block is not stored, round 0, a round not reached yet, a txid not in the
 * round), or the error is not a 404:
 * - the route is only registered with time travel on (`EnableTimeTravel`), so
 *   a node without it, or stock algod, or a dtalgod node from before the
 *   endpoint, answers the router's `Not Found`;
 * - a node whose ledger has no time travel history says so.
 */
export function stateChangesUnsupportedReason(err: unknown) {
  const { status, text } = describe(err);
  if (status !== 404) return undefined;
  if (/has no time travel history|need the time travel history/.test(text)) {
    return 'its ledger has no time travel history';
  }
  if (/failed retrieving State Delta/.test(text)) return undefined;
  return 'it does not serve the endpoint: time travel is off (EnableTimeTravel), or it predates it';
}

/**
 * The app state changes of each transaction of a round
 * (`GET /v2/deltas/{round}/txn/state-changes`): globals, local states and
 * boxes, each with its app and its value before and after the transaction,
 * for the transactions that changed any, top-level and inner, in execution
 * order. A transaction's changes are the net over it and its inner
 * transactions; a key that ends as it began is left out. Requires a dtalgod
 * node with time travel (`EnableTimeTravel`); see
 * `DTAlgodClient.supportsStateChanges`.
 *
 * The node re-evaluates the round's block, so each request costs about a
 * block's evaluation whatever the filters: `app()`, `txid()` and `txids()`
 * shrink the answer, not the work. Ask for a group's transactions in one
 * request with `txids()` rather than one request per transaction.
 *
 * The response is msgpack, whose size counts against the node's
 * `CapabilitiesResponse.stateChanges.maxResponseBytes`: a larger answer is a
 * 400 that `isStateChangesTooLarge` recognizes; narrow it with `app()` or
 * `txids()`. A round whose block is not stored, round 0, a round not reached
 * yet or a txid not in the round is the node's 404, thrown as the HTTP error.
 * A node that does not serve the endpoint is thrown as a
 * {@link DTUnsupportedError}. `isNodeBusy` (503, every re-evaluation slot in
 * use) and `isTimeLimitExceeded` (504) recognize the other usual errors.
 *
 * The answer does not carry `X-Algod-TT-Round`; the round is the path's, and
 * the response's `round` is checked against it.
 *
 * #### Example
 * ```typescript
 * const { txns } = await algodClient
 *   .getTxnStateChangesForRound(50_000_000)
 *   .txids(group.map((t) => t.txID()))
 *   .do();
 * for (const t of txns) {
 *   for (const c of t.changes) {
 *     console.log(t.path, c.appId, c.appStateType, c.key, c.before, c.after);
 *   }
 * }
 * ```
 *
 * @category GET
 */
export default class GetTxnStateChangesForRound extends JSONRequest<TxnStateChangesResponse> {
  private round: bigint;

  constructor(c: HTTPClient, round: number | bigint) {
    super(c);
    this.round = ensureBigInt(round);
    this.query.format = 'msgpack';
  }

  /**
   * @returns `/v2/deltas/${round}/txn/state-changes`
   */
  path() {
    return `/v2/deltas/${this.round}/txn/state-changes`;
  }

  /**
   * Only the changes to this app's state. 0 sends no filter.
   *
   * @param appId - The app.
   * @category query
   */
  app(appId: number | bigint) {
    const id = ensureBigInt(appId);
    if (id < BigInt(0) || id > BigInt('0xffffffffffffffff')) {
      throw new Error(`Not an app ID: ${id}`);
    }
    if (id === BigInt(0)) delete this.query.app;
    else this.query.app = id.toString();
    return this;
  }

  /**
   * Only this top-level transaction and its inner transactions. Combines with
   * `txids()`. A transaction not in the round is the node's 404.
   *
   * @param txid - The transaction ID.
   * @category query
   */
  txid(txid: string) {
    this.query.txid = checkTxid(txid);
    return this;
  }

  /**
   * Only these top-level transactions and their inner transactions, such as
   * a group's, listed in execution order whatever their order here; repeats
   * are ignored. Replaces any list set before, and combines with `txid()`.
   * Sent as one comma-separated parameter. An empty list is rejected here,
   * as the node rejects it; a transaction not in the round is the node's 404.
   *
   * @param txids - The transaction IDs.
   * @category query
   */
  txids(txids: readonly string[]) {
    if (txids.length === 0) {
      throw new Error('txids needs at least one transaction ID');
    }
    this.query.txids = txids.map(checkTxid).join(',');
    return this;
  }

  protected async executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    try {
      return await super.executeRequest(headers, customOptions);
    } catch (err) {
      const reason = stateChangesUnsupportedReason(err);
      if (reason !== undefined) {
        throw new DTUnsupportedError(
          `The node cannot list state changes: ${reason}`,
          { requestedRound: this.round, cause: err }
        );
      }
      throw err;
    }
  }

  /**
   * Decodes the response and checks that it is for the round asked for. A
   * mismatch is a node bug, thrown as an `Error`.
   */
  prepare(response: HTTPClientResponse): TxnStateChangesResponse {
    const data = decodeMsgpack(response.body, TxnStateChangesResponse);
    if (data.round !== this.round) {
      throw new Error(
        `The state changes are for round ${data.round}, not the round asked for, ${this.round}`
      );
    }
    return data;
  }
}
