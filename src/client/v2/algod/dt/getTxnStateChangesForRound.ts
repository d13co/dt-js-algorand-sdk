import JSONRequest from '../../jsonrequest.js';
import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeMsgpack } from '../../../../encoding/encoding.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import { describe, DTUnsupportedError } from './errors.js';
import { CapabilitiesResponse, TxnStateChangesResponse } from './models.js';

/**
 * What `include()` can add to a state changes answer as `groups`, and what
 * `full()` adds:
 * - `accounts`: each group's account changes (`GroupStateChanges.accounts`);
 * - `assets`: its holding and asset params changes (`holdings`, `assets`);
 * - `apps`: its app params and local state changes (`apps`, `localStates`).
 */
export type StateChangesGroupInclude = 'accounts' | 'assets' | 'apps';

/**
 * What `include()` can add to a state changes answer: the
 * {@link StateChangesGroupInclude} values, and
 * - `budget`: the opcode budget of each program run (`budget`);
 * - `reads`: the app state each transaction read (`reads`);
 * - `trace`: the execution traces of one transaction's group and the
 *   disassembly of their programs (`traces`, `programs`); see `trace()`.
 */
export type StateChangesInclude =
  | StateChangesGroupInclude
  | 'budget'
  | 'reads'
  | 'trace';

/** The {@link StateChangesGroupInclude} values, as `full()` sends them. */
export const STATE_CHANGES_INCLUDE: readonly StateChangesGroupInclude[] =
  Object.freeze(['accounts', 'assets', 'apps']);

/** Every value of {@link StateChangesInclude}, in the order they are sent. */
export const ALL_STATE_CHANGES_INCLUDE: readonly StateChangesInclude[] =
  Object.freeze(['accounts', 'assets', 'apps', 'budget', 'reads', 'trace']);

const GROUP_INCLUDE: readonly string[] = STATE_CHANGES_INCLUDE;

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
 * Whether a 400 answer to a state changes request with `include` says the
 * node does not offer a value its cached capabilities listed: a node from
 * before budget, reads and traces, which takes only the group values, or
 * one without `EnableDeveloperAPI` asked for `trace`. Either
 * means the node behind the address changed since the capabilities were
 * read.
 */
function includeRejected(err: unknown): boolean {
  const { status, text } = describe(err);
  return (
    status === 400 &&
    /include takes accounts, assets and apps,|include=trace needs node config EnableDeveloperAPI/.test(
      text
    )
  );
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
 * and the round's `feeSink`. `include()` also takes `budget` (the opcode
 * budget of each program run, `budget`), `reads` (the app state each
 * transaction read, `reads`) and `trace` (see `trace()`: one transaction
 * group's execution traces, `traces`, and the disassembly of their
 * programs, `programs`). A node that cannot add a value (see
 * `CapabilitiesResponse.stateChanges.include`,
 * `DTAlgodClient.supportsFullDeltas` and
 * `DTAlgodClient.supportsStateChangesInclude`) would ignore the parameter or
 * reject it, so the request checks the node's capabilities first and throws
 * a {@link DTUnsupportedError} without sending it.
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
 *
 * // One transaction's group, traced, with each program's budget.
 * const traced = await algodClient
 *   .getTxnStateChangesForRound(round)
 *   .include(['budget', 'reads'])
 *   .trace(txid)
 *   .do();
 * const top = traced.traces!.find((t) => t.txid === txid)!.execTrace;
 * for (const step of top.approvalProgramTrace ?? []) {
 *   const line = programLine(traced, top.approvalProgramHash!, step.pc);
 *   console.log(step.pc, line?.text);
 * }
 * // The traced transaction's own programs: its logic sig, its app's.
 * for (const b of budgetOf(traced, txid)) console.log(b.kind, b.cost);
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
   * What else to list, in any order; repeats are ignored. Replaces any list
   * set before (`full()` and `trace()` add to it instead):
   * - what each group changed other than app state, as the answer's
   *   `groups` (and its `feeSink`): `accounts`, `assets` (holdings and asset
   *   params) and `apps` (app params and local states);
   * - `budget`: the opcode budget of each program run, as `budget`;
   * - `reads`: the app state each transaction read, as `reads`;
   * - `trace`: one transaction group's execution traces and programs, as
   *   `traces` and `programs` (see `trace()`, which also checks the txid).
   *
   * `txids()` and `txid()` narrow them all to their transactions (and
   * groups); `app()` does not, as it narrows only `txns`. An empty list or an
   * unknown value is rejected here; a node that cannot add one of them is
   * thrown as a {@link DTUnsupportedError} by `do()`, without sending the
   * request.
   *
   * @param parts - What to add.
   * @category query
   */
  include(parts: readonly StateChangesInclude[]) {
    if (parts.length === 0) {
      throw new Error(
        `include needs at least one of ${ALL_STATE_CHANGES_INCLUDE.join(', ')}`
      );
    }
    for (const p of parts) {
      if (!ALL_STATE_CHANGES_INCLUDE.includes(p)) {
        throw new Error(
          `Not a state changes include: ${JSON.stringify(p)} (${ALL_STATE_CHANGES_INCLUDE.join(', ')})`
        );
      }
    }
    this.included = ALL_STATE_CHANGES_INCLUDE.filter((p) => parts.includes(p));
    this.query.include = this.included.join(',');
    return this;
  }

  /** Adds to the include list instead of replacing it. */
  private addInclude(parts: readonly StateChangesInclude[]) {
    return this.include([...this.included, ...parts]);
  }

  /**
   * Every group change: adds `accounts`, `assets` and `apps` to the include
   * list, keeping any other value set before (`budget`, `reads`, `trace`).
   *
   * @category query
   */
  full() {
    return this.addInclude(STATE_CHANGES_INCLUDE);
  }

  /**
   * The execution traces of one transaction's group, as simulate gives them
   * with stack, scratch and state changes, as the answer's `traces`, and the
   * disassembly of the programs they ran, as `programs` (`programLine` maps
   * a trace's `pc` to its line): adds `trace` to the include list, keeping
   * the values set before. `txid` sets `txid()`.
   *
   * The node traces exactly one transaction, given with `txid()`, or with a
   * `txids()` list of one distinct ID (or the same one in both): anything
   * else is thrown by `do()` without sending the request. It needs a node
   * with `EnableDeveloperAPI`, whose capabilities list `trace`
   * (`DTAlgodClient.supportsStateChangesInclude('trace')`); on another, `do()`
   * throws a {@link DTUnsupportedError} without sending it.
   *
   * @param txid - The transaction to trace, if not given with `txid()` or
   * `txids()`.
   * @category query
   */
  trace(txid?: string) {
    if (txid !== undefined) this.txid(txid);
    return this.addInclude(['trace']);
  }

  /** The distinct transaction IDs of `txid()` and `txids()`. */
  private askedTxids(): Set<string> {
    const ids = new Set<string>();
    if (this.query.txid !== undefined) ids.add(this.query.txid as string);
    if (this.query.txids !== undefined) {
      for (const id of (this.query.txids as string).split(',')) ids.add(id);
    }
    return ids;
  }

  protected async executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    if (this.included.includes('trace')) {
      const n = this.askedTxids().size;
      if (n !== 1) {
        throw new Error(
          `trace needs exactly one transaction, with txid() or txids(), not ${n}`
        );
      }
    }
    if (this.included.length > 0) {
      const offered = (await this.capabilities()).stateChanges?.include ?? [];
      const missing = this.included.filter((p) => !offered.includes(p));
      if (missing.length > 0) {
        const why = missing.includes('trace')
          ? ' (trace needs EnableDeveloperAPI)'
          : '';
        throw new DTUnsupportedError(
          `The node cannot add to the state changes: it does not offer include=${missing.join(',')}${why}`,
          { requestedRound: this.round }
        );
      }
    }
    try {
      return await super.executeRequest(headers, customOptions);
    } catch (err) {
      if (this.included.length > 0 && includeRejected(err)) {
        this.forgetCapabilities();
        throw new DTUnsupportedError(
          `The node cannot add to the state changes: it rejected include=${this.included.join(',')}`,
          { requestedRound: this.round, cause: err }
        );
      }
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
   * mismatch is a node bug, thrown as an `Error`. With a group include
   * (`accounts`, `assets`, `apps`), the node always sends `feeSink`, and with
   * `trace` always `traces`: an answer without them is from a node that
   * ignored `include`, as one behind the same address but older may, thrown
   * as a {@link DTUnsupportedError} (and the cached capabilities are
   * dropped). A list asked for that the node left out because it was empty
   * (`groups`, `budget`, `reads`, `programs`) is an empty list. With only
   * `budget` and `reads`, nothing in the answer tells a node that ignored
   * them from one that had none: an empty list is trusted to the
   * capabilities.
   */
  prepare(response: HTTPClientResponse): TxnStateChangesResponse {
    const data = decodeMsgpack(response.body, TxnStateChangesResponse);
    if (data.round !== this.round) {
      throw new Error(
        `The state changes are for round ${data.round}, not the round asked for, ${this.round}`
      );
    }
    const has = (p: StateChangesInclude) => this.included.includes(p);
    // With trace, the node lists every transaction of the traced one's group
    // (an empty trace for one that ran no program), and a txid not in the
    // round is a 404, so a 200 without traces ignored include.
    const ignored =
      (this.included.some((p) => GROUP_INCLUDE.includes(p)) &&
        data.feeSink === undefined) ||
      (has('trace') && data.traces === undefined);
    if (ignored) {
      this.forgetCapabilities();
      throw new DTUnsupportedError(
        `The node cannot add to the state changes: it ignored include=${this.included.join(',')}`,
        { requestedRound: this.round }
      );
    }
    if (this.included.some((p) => GROUP_INCLUDE.includes(p))) {
      data.groups ??= [];
    }
    if (has('budget')) data.budget ??= [];
    if (has('reads')) data.reads ??= [];
    if (has('trace')) data.programs ??= [];
    return data;
  }
}
