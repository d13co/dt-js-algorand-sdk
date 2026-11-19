import JSONRequest from '../../jsonrequest.js';
import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeMsgpack } from '../../../../encoding/encoding.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import { describe, DTUnsupportedError } from './errors.js';
import { CapabilitiesResponse, TxnStateChangesResponse } from './models.js';

/**
 * What `include()` can add to a state changes answer, as `groups`:
 * - `accounts`: each group's account changes (`GroupStateChanges.accounts`);
 * - `assets`: its holding and asset params changes (`holdings`, `assets`);
 * - `apps`: its app params and local state changes (`apps`, `localStates`).
 */
export type StateChangesInclude = 'accounts' | 'assets' | 'apps';

/** Every value of {@link StateChangesInclude}, as `full()` sends them. */
export const STATE_CHANGES_INCLUDE: readonly StateChangesInclude[] =
  Object.freeze(['accounts', 'assets', 'apps']);

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
 * With `include()` or `full()`, the answer also has `groups`: everything
 * else each group changed (accounts, holdings, asset and app params, local
 * state opt-ins and opt-outs) with the values before and after the group,
 * and the round's `feeSink`. A node that cannot add them (see
 * `CapabilitiesResponse.stateChanges.include`, and
 * `DTAlgodClient.supportsFullDeltas`) would ignore the parameter, so the
 * request checks the node's capabilities first and throws a
 * {@link DTUnsupportedError} without sending it.
 *
 * #### Example
 * ```typescript
 * const res = await algodClient
 *   .getTxnStateChangesForRound(50_000_000)
 *   .txids(group.map((t) => t.txID()))
 *   .full()
 *   .do();
 * for (const t of res.txns) {
 *   for (const c of t.changes) {
 *     console.log(t.path, c.appId, c.appStateType, c.key, c.before, c.after);
 *   }
 * }
 * for (const g of res.groups!) {
 *   for (const a of withoutFeeSink(g, res.feeSink!).accounts) {
 *     console.log(a.address, changedFields(a.before, a.after));
 *   }
 * }
 * ```
 *
 * @category GET
 */
export default class GetTxnStateChangesForRound extends JSONRequest<TxnStateChangesResponse> {
  private round: bigint;

  private included: StateChangesInclude[] = [];

  /**
   * @param c - The HTTP client.
   * @param round - The round.
   * @param capabilities - The node's capabilities, checked before sending
   * `include` (`DTAlgodClient.capabilities`, which caches them).
   * @param forgetCapabilities - Drops the cached capabilities, when a node
   * ignored `include` that they said it offers.
   */
  constructor(
    c: HTTPClient,
    round: number | bigint,
    private capabilities: () => Promise<CapabilitiesResponse>,
    private forgetCapabilities: () => void = () => {}
  ) {
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

  /**
   * Also list what each group changed other than app state, as the answer's
   * `groups` (and its `feeSink`): `accounts`, `assets` (holdings and asset
   * params) and `apps` (app params and local states), in any order; repeats
   * are ignored. Replaces any list set before. `txids()` and `txid()` narrow
   * the groups to theirs; `app()` does not. An empty list or an unknown
   * value is rejected here; a node that cannot add one of them is thrown as
   * a {@link DTUnsupportedError} by `do()`, without sending the request.
   *
   * @param parts - What to add.
   * @category query
   */
  include(parts: readonly StateChangesInclude[]) {
    if (parts.length === 0) {
      throw new Error('include needs at least one of accounts, assets, apps');
    }
    for (const p of parts) {
      if (!STATE_CHANGES_INCLUDE.includes(p)) {
        throw new Error(
          `Not a state changes include: ${JSON.stringify(p)} (accounts, assets or apps)`
        );
      }
    }
    this.included = STATE_CHANGES_INCLUDE.filter((p) => parts.includes(p));
    this.query.include = this.included.join(',');
    return this;
  }

  /**
   * Everything: `include(['accounts', 'assets', 'apps'])`.
   *
   * @category query
   */
  full() {
    return this.include(STATE_CHANGES_INCLUDE);
  }

  protected async executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    if (this.included.length > 0) {
      const offered = (await this.capabilities()).stateChanges?.include ?? [];
      const missing = this.included.filter((p) => !offered.includes(p));
      if (missing.length > 0) {
        throw new DTUnsupportedError(
          `The node cannot list group changes: it does not offer include=${missing.join(',')}`,
          { requestedRound: this.round }
        );
      }
    }
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
   * mismatch is a node bug, thrown as an `Error`. With `include`, the node
   * always sends `feeSink`: an answer without it is from a node that ignored
   * `include`, as one behind the same address but older may, thrown as a
   * {@link DTUnsupportedError} (and the cached capabilities are dropped).
   * `groups` is an empty list if the node left it out (a round with no
   * transactions).
   */
  prepare(response: HTTPClientResponse): TxnStateChangesResponse {
    const data = decodeMsgpack(response.body, TxnStateChangesResponse);
    if (data.round !== this.round) {
      throw new Error(
        `The state changes are for round ${data.round}, not the round asked for, ${this.round}`
      );
    }
    if (this.included.length > 0) {
      if (data.feeSink === undefined) {
        this.forgetCapabilities();
        throw new DTUnsupportedError(
          `The node cannot list group changes: it ignored include=${this.included.join(',')}`,
          { requestedRound: this.round }
        );
      }
      if (data.groups === undefined) data.groups = [];
    }
    return data;
  }
}
