import { AlgodClient } from '../algod.js';
import { BaseHTTPClient } from '../../../baseHTTPClient.js';
import { Address } from '../../../../encoding/address.js';
import AccountInformationAt from './accountInformationAt.js';
import AccountAssetInformationAt from './accountAssetInformationAt.js';
import AccountApplicationInformationAt from './accountApplicationInformationAt.js';
import AccountAssetsInformationAt from './accountAssetsInformationAt.js';
import AccountApplicationsInformationAt from './accountApplicationsInformationAt.js';
import SupplyAt from './supplyAt.js';
import GetAssetByIDAt from './getAssetByIDAt.js';
import GetApplicationByIDAt from './getApplicationByIDAt.js';
import AccountVersions from './accountVersions.js';
import AccountAssetVersions from './accountAssetVersions.js';
import AccountApplicationVersions from './accountApplicationVersions.js';
import GetAssetVersions from './getAssetVersions.js';
import GetAssetHolders from './getAssetHolders.js';
import GetApplicationVersions from './getApplicationVersions.js';
import GetApplicationBoxByNameAt from './getApplicationBoxByNameAt.js';
import GetApplicationBoxesAt from './getApplicationBoxesAt.js';
import GetApplicationBoxVersions from './getApplicationBoxVersions.js';
import GetApplicationBoxesVersions from './getApplicationBoxesVersions.js';
import SimulateTransactionsAt from './simulateTransactionsAt.js';
import GetCapabilities from './getCapabilities.js';
import RunQuery from './query.js';
import { DTUnsupportedError } from './errors.js';
import {
  QueryRequest,
  QueryRequestParams,
  CapabilitiesResponse,
} from './models.js';
import {
  SimulateRequest,
  SimulateRequestTransactionGroup,
} from '../models/types.js';
import { SignedTransaction } from '../../../../signedTransaction.js';
import { decodeMsgpack } from '../../../../encoding/encoding.js';

/**
 * An {@link AlgodClient} for a time-travel algod (`EnableTimeTravel: true`),
 * which keeps the state of every round since genesis. It adds reads at past
 * rounds and the rounds at which objects changed.
 *
 * "At round R" always means the state at the end of round R, after all of that
 * round's transactions.
 *
 * #### Example
 * ```typescript
 * const algodClient = new algosdk.DTAlgodClient(token, server, port);
 * const box = await algodClient
 *   .getApplicationBoxByName(1234, boxName)
 *   .round(45000000)
 *   .do();
 * ```
 */
export class DTAlgodClient extends AlgodClient {
  /**
   * What this build of the client supports, for code that finds
   * `DTAlgodClient` at runtime on an algosdk that may be stock algosdk
   * rather than dtalgosdk (algokit-utils and generated clients check it). It
   * lists what the SDK has, not what the node has: use
   * {@link DTAlgodClient.capabilities}, {@link DTAlgodClient.supportsDT}
   * and {@link DTAlgodClient.supportsAssetHolders} for the node.
   * - `reads-at-round`: `.round()` on the account, asset, application, box and
   *   supply reads;
   * - `versions`: the `...Versions` methods;
   * - `simulate-groups`, `parallel-groups`, `simulate-rounds`: several groups,
   *   `parallelGroups()` and `rounds()` in `simulateTransactions`;
   * - `from`: {@link DTAlgodClient.from};
   * - `group-results`: `groupResult()` / `groupResults()` on the simulate
   *   response;
   * - `from-transactions`: `DTSimulateRequest.fromTransactions`;
   * - `pack-rounds`: `packSimulateRounds`;
   * - `validity-window`: `skipValidityWindow()` and `rewriteValidityWindow()`
   *   in `simulateTransactions`, and `maxSpan: null` in `packSimulateRounds`;
   * - `simulate-protocol`: `protocol()` in `simulateTransactions`, and
   *   `protocolOverride` on the response and its round results;
   * - `capabilities`: `capabilities()` and `getCapabilities()`
   *   (`GET /v2/capabilities`: `timeTravel`, `developerApi`,
   *   `timeLimitSeconds`, the `simulate` limits and the `query` limits);
   * - `query`: `query()`, and `query` on `capabilities()`;
   * - `versions-rounds`: `rounds()` on the `...Versions` methods, and
   *   `changedRound` on their entries;
   * - `versions-keys`: `include('keys')` on `getApplicationVersions`,
   *   `accountVersions` and `accountApplicationVersions`, and `changedKeys`;
   * - `versions-pages`: `pages()` on the `...Versions` methods;
   * - `holders`: `getAssetHolders` and `supportsAssetHolders`;
   * - `response-headers`: `doWithHeaders()` on every request, and
   *   `effortOf` / `parseEffortHeader` for the `X-Algod-Effort` header;
   * - `error-helpers`: `isNodeBusy`, `retryAfterSeconds`,
   *   `isTimeLimitExceeded`, `isRoundTooLarge`, `isHistoryUnavailable`;
   * - `round-header`: reads at a round, holders pages included, check the
   *   `X-Algod-TT-Round` header (`TT_ROUND_HEADER`; the boxes list checks its
   *   `round`), so an answer as of another round, such as stock algod's as of
   *   its latest round, is thrown as a {@link DTUnsupportedError}.
   *
   * #### Example
   * ```typescript
   * const DT = (algosdk as any).DTAlgodClient;
   * if (DT?.features?.includes('group-results')) {
   *   const client = DT.from(algod);
   * }
   * ```
   */
  static readonly features: readonly string[] = Object.freeze([
    'reads-at-round',
    'versions',
    'simulate-groups',
    'parallel-groups',
    'simulate-rounds',
    'from',
    'group-results',
    'from-transactions',
    'pack-rounds',
    'validity-window',
    'simulate-protocol',
    'capabilities',
    'query',
    'versions-rounds',
    'versions-keys',
    'versions-pages',
    'holders',
    'response-headers',
    'error-helpers',
    'round-header',
  ]);

  /** The clients made by {@link DTAlgodClient.from}, by source client. */
  private static fromCache = new WeakMap<object, DTAlgodClient>();

  /**
   * A `DTAlgodClient` that sends its requests through an existing
   * {@link AlgodClient}'s HTTP client: same server, token, headers and custom
   * `BaseHTTPClient`, if any. Returns `algod` itself if it already is a
   * `DTAlgodClient`. Calling it again with the same client returns
   * the same `DTAlgodClient`, so what it caches, such as
   * `capabilities()`, is kept.
   *
   * `algod` may come from another copy of algosdk (it is read by shape, not
   * `instanceof`), but transactions and models passed to this client must come
   * from this copy, so make the app use a single copy.
   *
   * #### Example
   * ```typescript
   * const algodClient = algosdk.DTAlgodClient.from(
   *   algorand.client.algod
   * );
   * ```
   *
   * @param algod - The client to share the connection of.
   * @throws TypeError if `algod` is not shaped like an `AlgodClient`.
   */
  static from(algod: AlgodClient | { c: unknown }): DTAlgodClient {
    if (algod instanceof DTAlgodClient) return algod;
    const cached = DTAlgodClient.fromCache.get(algod);
    if (cached) return cached;
    const bc = (algod as unknown as { c?: { bc?: Partial<BaseHTTPClient> } })?.c
      ?.bc;
    if (
      typeof bc?.get !== 'function' ||
      typeof bc.post !== 'function' ||
      typeof bc.delete !== 'function'
    ) {
      throw new TypeError(
        'DTAlgodClient.from expects an AlgodClient: found no HTTP client with get, post and delete on it'
      );
    }
    const client = new DTAlgodClient(bc as BaseHTTPClient, '');
    DTAlgodClient.fromCache.set(algod, client);
    return client;
  }

  private supportsAssetHoldersResult?: Promise<boolean>;

  private capabilitiesResult?: Promise<CapabilitiesResponse>;

  /**
   * Given an account address, return the account information, at the latest
   * round or, with `.round()`, at a past round.
   *
   * #### Example
   * ```typescript
   * const account = await algodClient
   *   .accountInformation(address)
   *   .exclude('all')
   *   .round(45000000)
   *   .do();
   * ```
   *
   * @param account - The address of the account to look up.
   * @category GET
   */
  accountInformation(account: string | Address) {
    return new AccountInformationAt(this.c, account);
  }

  /**
   * Given an account address and an asset ID, return the account's holding of
   * the asset (and its parameters if the account created it), at the latest
   * round or, with `.round()`, at a past round.
   *
   * @param account - The address of the account to look up.
   * @param index - The asset ID to look up.
   * @category GET
   */
  accountAssetInformation(account: string | Address, index: number | bigint) {
    return new AccountAssetInformationAt(this.c, account, index);
  }

  /**
   * Given an account address, return its asset holdings, at the latest round
   * or, with `.round()`, at a past round.
   *
   * @param account - The address of the account to look up.
   * @category GET
   */
  accountAssetsInformation(account: string | Address) {
    return new AccountAssetsInformationAt(this.c, account);
  }

  /**
   * Given an account address, return its applications, at the latest round
   * or, with `.round()`, at a past round.
   *
   * @param account - The address of the account to look up.
   * @category GET
   */
  accountApplicationsInformation(account: string | Address) {
    return new AccountApplicationsInformationAt(this.c, account);
  }

  /**
   * Given an account address and an application ID, return the account's
   * local state for the application (and its parameters if the account created
   * it), at the latest round or, with `.round()`, at a past round.
   *
   * @param account - The address of the account to look up.
   * @param index - The application ID to look up.
   * @category GET
   */
  accountApplicationInformation(
    account: string | Address,
    index: number | bigint
  ) {
    return new AccountApplicationInformationAt(this.c, account, index);
  }

  /**
   * Return the supply, at the latest round or, with `.round()`, at a past
   * round.
   *
   * @category GET
   */
  supply() {
    return new SupplyAt(this.c);
  }

  /**
   * Given an asset ID, return the asset, at the latest round or, with
   * `.round()`, at a past round.
   *
   * Stock algod ignores `.round()` and answers with the latest asset, which
   * the client detects (no `X-Algod-TT-Round` header) and throws as a
   * {@link DTUnsupportedError}: check `supportsDT()` first.
   *
   * @param index - The asset ID to look up.
   * @category GET
   */
  getAssetByID(index: number | bigint) {
    return new GetAssetByIDAt(this.c, index);
  }

  /**
   * Given an application ID, return the application, at the latest round or,
   * with `.round()`, at a past round.
   *
   * Stock algod ignores `.round()` and answers with the latest application,
   * which the client detects (no `X-Algod-TT-Round` header) and throws as a
   * {@link DTUnsupportedError}: check `supportsDT()` first.
   *
   * @param index - The application ID to look up.
   * @category GET
   */
  getApplicationByID(index: number | bigint) {
    return new GetApplicationByIDAt(this.c, index);
  }

  /**
   * Given an application ID and the box name (key), return the value stored in
   * the box, at the latest round or, with `.round()`, at a past round.
   *
   * #### Example
   * ```typescript
   * const box = await algodClient
   *   .getApplicationBoxByName(1234, boxName)
   *   .round(45000000)
   *   .do();
   * ```
   *
   * @param index - The application ID to look up.
   * @param boxName - The box name.
   * @category GET
   */
  getApplicationBoxByName(index: number | bigint, boxName: Uint8Array) {
    return new GetApplicationBoxByNameAt(this.c, index, boxName);
  }

  /**
   * Given an application ID, return the boxes associated with the app, at the
   * latest round or, with `.round()`, at a past round.
   *
   * #### Example
   * ```typescript
   * const boxes = await algodClient
   *   .getApplicationBoxes(1234)
   *   .round(45000000)
   *   .limit(100)
   *   .include('values')
   *   .do();
   * ```
   *
   * @param index - The application ID to look up.
   * @category GET
   */
  getApplicationBoxes(index: number | bigint) {
    return new GetApplicationBoxesAt(this.c, index);
  }

  /**
   * Given an application ID and the box name, list the rounds at which the box
   * was created, written or deleted.
   *
   * #### Example
   * ```typescript
   * for await (const version of algodClient
   *   .getApplicationBoxVersions(1234, boxName)
   *   .include('values')
   *   .iterate()) {
   *   console.log(version.round, version.deleted, version.value);
   * }
   * ```
   *
   * @param index - The application ID to look up.
   * @param boxName - The box name.
   * @category GET
   */
  getApplicationBoxVersions(index: number | bigint, boxName: Uint8Array) {
    return new GetApplicationBoxVersions(this.c, index, boxName);
  }

  /**
   * Given an application ID, list the rounds at which any of its boxes was
   * created, written or deleted, with the boxes that changed in each.
   *
   * #### Example
   * ```typescript
   * const res = await algodClient
   *   .getApplicationBoxesVersions(1234)
   *   .order('desc')
   *   .limit(10)
   *   .do();
   * for (const version of res.versions) {
   *   const names = version.boxes.map((b) => new TextDecoder().decode(b.name));
   *   console.log(version.round, names);
   * }
   * ```
   *
   * @param index - The application ID to look up.
   * @category GET
   */
  getApplicationBoxesVersions(index: number | bigint) {
    return new GetApplicationBoxesVersions(this.c, index);
  }

  /**
   * Given an application ID, list the rounds at which the application's
   * parameters changed, including its creation and deletion.
   *
   * @param index - The application ID to look up.
   * @category GET
   */
  getApplicationVersions(index: number | bigint) {
    return new GetApplicationVersions(this.c, index);
  }

  /**
   * Given an asset ID, list the rounds at which the asset's parameters
   * changed, including its creation and destruction.
   *
   * @param index - The asset ID to look up.
   * @category GET
   */
  getAssetVersions(index: number | bigint) {
    return new GetAssetVersions(this.c, index);
  }

  /**
   * Given an asset ID, list the accounts that hold it at a round (the latest
   * by default), in address order, with their balance and frozen flag. Needs
   * a time-travel node with the asset holders index (`TimeTravelHoldersIndex`);
   * one with either off is thrown as a {@link DTUnsupportedError}.
   * {@link DTAlgodClient.supportsAssetHolders} finds out first.
   *
   * Pages can be short or empty while more holders remain: page with
   * `pages()` or `iterate()`, which pin the first page's round, or pass the
   * same `round()` with each `next()` yourself.
   *
   * #### Example
   * ```typescript
   * let total = 0n;
   * for await (const h of algodClient.getAssetHolders(31566704).iterate()) {
   *   total += h.amount;
   * }
   * ```
   *
   * @param index - The asset ID to look up.
   * @category GET
   */
  getAssetHolders(index: number | bigint) {
    return new GetAssetHolders(this.c, index);
  }

  /**
   * Given an account address, list the rounds at which anything
   * `accountInformation` returns changed. Each version lists only the objects
   * that changed in that round.
   *
   * #### Example
   * ```typescript
   * const res = await algodClient
   *   .accountVersions(address)
   *   .exclude('all')
   *   .order('desc')
   *   .limit(10)
   *   .include('values')
   *   .do();
   * ```
   *
   * @param account - The address of the account to look up.
   * @category GET
   */
  accountVersions(account: string | Address) {
    return new AccountVersions(this.c, account);
  }

  /**
   * Given an account address and an asset ID, list the rounds at which the
   * account's holding of the asset changed and, if the account created it, the
   * asset's parameters.
   *
   * @param account - The address of the account to look up.
   * @param index - The asset ID to look up.
   * @category GET
   */
  accountAssetVersions(account: string | Address, index: number | bigint) {
    return new AccountAssetVersions(this.c, account, index);
  }

  /**
   * Given an account address and an application ID, list the rounds at which
   * the account's local state for the application changed and, if the account
   * created it, the application's parameters.
   *
   * @param account - The address of the account to look up.
   * @param index - The application ID to look up.
   * @category GET
   */
  accountApplicationVersions(
    account: string | Address,
    index: number | bigint
  ) {
    return new AccountApplicationVersions(this.c, account, index);
  }

  /**
   * Simulate transactions, with the fork's simulate features on top of
   * {@link AlgodClient.simulateTransactions}:
   *
   * - `txnGroups` may hold several groups, up to the node's
   *   `MaxAPISimulateGroups` (default 16; `simulate.maxTxnGroups` of
   *   {@link DTAlgodClient.capabilities} has the node's value). By default they run in order as
   *   consecutive groups of one simulated block: each group sees the effects
   *   of the groups before it, a transaction or lease used by an earlier group
   *   is a duplicate, and the groups share the block's byte limit, so a group
   *   that does not fit fails while a smaller later group may still fit. A
   *   group that fails is rolled back and the later groups still run, except
   *   after a failed post-evaluation check (placeholder PQ signatures with
   *   `fixSigners`) or a corrupted evaluator: every later group is then
   *   reported as not simulated. Each group's failure is in its own
   *   `failureMessage` / `failedAt` (0-based). `extraOpcodeBudget` applies to
   *   each group, up to the node's `simulate.maxExtraOpcodeBudget`.
   * - With `.parallelGroups()` (or `parallelGroups` on a
   *   {@link DTSimulateRequest}), every group is simulated alone
   *   against the state at the start round, concurrently.
   * - With `.rounds([...])` (or `rounds` on a
   *   {@link DTSimulateRequest}), the request is simulated once per
   *   listed round (0 is the latest), and the results are in `roundResults`,
   *   one per entry in request order. A round that cannot be simulated has an
   *   `error` in its entry instead of failing the request. The top-level
   *   `lastRound` is then 0 and `txnGroups` is empty. With a time-travel node
   *   (`EnableTimeTravel`) any round since genesis can be listed; otherwise
   *   only the node's last few rounds. `AtomicTransactionComposer.simulate`
   *   reads the top-level `txnGroups`, so use the client directly for this.
   * - With `.skipValidityWindow()` or `.rewriteValidityWindow()` (only with
   *   `rounds`), the transactions are evaluated outside their validity window,
   *   or have it moved to each simulated block, so the rounds can be more than
   *   `MaxTxnLife` (1000) apart.
   * - With `.protocol('v42')` (or `latest`, ...), the round is simulated
   *   under a later consensus protocol, as if an upgrade to it took effect
   *   right after the start round. `protocolOverride` on the response (on
   *   each round result, with `rounds`) says how it applied.
   *
   * The node may also raise the limits on unnamed resources
   * (`allowUnnamedResources`) with its `SimulateResourceLimitMultiplier`
   * setting. The resources it then reports may not fit in a group that can be
   * submitted.
   *
   * A node with `rounds` disabled (`simulate.maxRounds` 0 in
   * {@link DTAlgodClient.capabilities}) is thrown as a
   * {@link DTUnsupportedError}. Several groups, `rounds` and the fork's
   * fields need a dtalgod node: stock algod rejects them with a 400.
   *
   * #### Example
   * ```typescript
   * const request = new algosdk.dtModels.DTSimulateRequest({
   *   txnGroups: [fundGroup, spendGroup].map(
   *     (txns) => new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns })
   *   ),
   *   allowEmptySignatures: true,
   * });
   * const res = await algodClient.simulateTransactions(request).do();
   * res.txnGroups.forEach((g, i) => console.log(i, g.failureMessage ?? 'ok'));
   *
   * // The same groups at three rounds.
   * const atRounds = await algodClient
   *   .simulateTransactions(request)
   *   .rounds([45000000, 46000000, 0])
   *   .do();
   * for (const r of atRounds.roundResults!) {
   *   console.log(r.lastRound, r.error ?? r.txnGroups[1].failureMessage ?? 'ok');
   * }
   *
   * // Years apart, with each window moved to the round, under today's rules.
   * const underLatest = await algodClient
   *   .simulateTransactions(request)
   *   .rounds([20000000, 45000000])
   *   .rewriteValidityWindow()
   *   .protocol('latest')
   *   .do();
   * for (const r of underLatest.roundResults!) {
   *   const po = r.protocolOverride;
   *   console.log(r.lastRound, po?.from, '->', po?.to, po?.notes?.map((n) => n.code));
   * }
   * ```
   *
   * @param request - The simulate request. A {@link DTSimulateRequest}
   * can set the fork's fields.
   * @category POST
   */
  simulateTransactions(request: SimulateRequest) {
    return new SimulateTransactionsAt(this.c, request);
  }

  /**
   * Simulate signed transactions given as msgpack bytes. Several groups can be
   * passed as an array of arrays, one array per group; see
   * {@link DTAlgodClient.simulateTransactions} for how they run.
   *
   * #### Example
   * ```typescript
   * const res = await algodClient
   *   // Each group is a Uint8Array[] of encoded signed transactions.
   *   .simulateRawTransactions([group1Txns, group2Txns])
   *   .parallelGroups()
   *   .do();
   * ```
   *
   * @param stxOrStxs - One signed transaction, one group, or several groups.
   * @category POST
   */
  simulateRawTransactions(
    stxOrStxs: Uint8Array | Uint8Array[] | Uint8Array[][]
  ) {
    let groups: Uint8Array[][];
    if (!Array.isArray(stxOrStxs)) {
      groups = [[stxOrStxs]];
    } else if (stxOrStxs.length > 0 && Array.isArray(stxOrStxs[0])) {
      groups = stxOrStxs as Uint8Array[][];
    } else {
      groups = [stxOrStxs as Uint8Array[]];
    }
    return this.simulateTransactions(
      new SimulateRequest({
        txnGroups: groups.map(
          (group) =>
            new SimulateRequestTransactionGroup({
              txns: group.map((stxn) => decodeMsgpack(stxn, SignedTransaction)),
            })
        ),
      })
    );
  }

  /**
   * Run read-only TEAL calls at one or more rounds (`POST /v2/query`): one
   * program (each call creates an app running it) or one deployed app (each
   * call is a NoOp call of `appId`), many calls with their own args and
   * references, at every listed round (0 is the latest; the latest by
   * default). Each call is an app call alone in its group, in the block after
   * the round, on the state that round left. There are no signatures, fees,
   * minimum balances or leases, every resource is available unnamed, writes
   * are dropped after each call, and a failed call does not affect the
   * others. The response has, per round, the logs, cost and error of each
   * call; inner transactions and state changes are not echoed.
   *
   * Unlike simulate, the default protocol is `latest`, not the protocol the
   * round really ran: past rounds then report a `protocolOverride` with
   * notes. Pass `protocol('round')` for the chain's own rules.
   *
   * Queries can be disabled on a node (`MaxAPIQueryCalls` 0): the `query` of
   * {@link DTAlgodClient.capabilities} is undefined then, and otherwise has
   * the limits to split requests by (`maxCalls`, `maxRounds`,
   * `maxCallBudget`, `maxCallLogBytes`, `maxCallStateBytes`,
   * `maxResponseBytes`). A node with queries disabled is thrown as a
   * {@link DTUnsupportedError}. Results
   * over `maxResponseBytes` fail with a 400 that `isQueryResponseTooLarge`
   * recognizes; split the request and retry. A busy node answers 503 with
   * `Retry-After`, and a request over the node's time limit 504.
   *
   * #### Example
   * ```typescript
   * const { query } = await algodClient.capabilities();
   * if (query) {
   *   const res = await algodClient
   *     .query({
   *       program: (await algodClient.compile(source).do()).result,
   *       calls: [{ args: [new TextEncoder().encode('hi')] }, {}],
   *     })
   *     .rounds([0, 50000000])
   *     .do();
   *   for (const r of res.rounds) {
   *     console.log(r.round, r.error ?? r.calls.map((c) => c.error ?? c.logs));
   *   }
   *
   *   // A deployed app, at the latest round.
   *   const app = await algodClient
   *     .query({ appId: 760937186, calls: [{ args: [selector] }] })
   *     .do();
   * }
   * ```
   *
   * @param request - The request, as a {@link QueryRequest} or a plain
   * object with its fields.
   * @category POST
   */
  query(request: QueryRequest | QueryRequestParams) {
    return new RunQuery(this.c, request);
  }

  /**
   * The node's capabilities (`GET /v2/capabilities`), as it reports them.
   * Every dtalgod node has the endpoint; stock algod answers 404, thrown as a
   * {@link DTUnsupportedError}. {@link DTAlgodClient.capabilities} caches the
   * answer and falls back to stock algod's capabilities instead.
   *
   * @category GET
   */
  getCapabilities() {
    return new GetCapabilities(this.c);
  }

  /**
   * The fork features the node has on, and the limits to build simulate and
   * query requests within. `simulate` has how many groups and `rounds`
   * entries a simulate request may hold and the most `extraOpcodeBudget`:
   * pass `simulate.maxRounds` to {@link packSimulateRounds}, and split groups
   * into requests of at most `simulate.maxTxnGroups`. `query` has the query
   * limits, and is undefined when queries are disabled.
   *
   * This is how the client tells what the node has: every dtalgod node
   * serves its capabilities, and its optional features show in them
   * (`timeTravel`, `developerApi`, `query`, `simulate.maxRounds` above 0,
   * `simulate.maxTxnGroups` above 1). Only the asset holders index does not:
   * see {@link DTAlgodClient.supportsAssetHolders}.
   *
   * Stock algod has no capabilities endpoint and answers 404; the answer is
   * then stock algod's ({@link CapabilitiesResponse.stock}), with `reported`
   * false: no time travel, no queries, one group per simulate request and no
   * `rounds`.
   *
   * The answer is cached on the client and shared, so it is frozen (its
   * `simulate` and `query` too). Other errors, such as network failures, are
   * rethrown and not cached.
   *
   * #### Example
   * ```typescript
   * const { simulate } = await algodClient.capabilities();
   * if (simulate.maxRounds === 0) {
   *   // No `rounds`: send one request per round, with `round` set.
   * } else {
   *   const { windows } = algosdk.packSimulateRounds(rounds, {
   *     maxRounds: simulate.maxRounds,
   *   });
   * }
   * ```
   */
  capabilities(): Promise<CapabilitiesResponse> {
    if (!this.capabilitiesResult) {
      this.capabilitiesResult = this.getCapabilities()
        .do()
        .catch((err) => {
          if (err instanceof DTUnsupportedError) {
            return CapabilitiesResponse.stock();
          }
          this.capabilitiesResult = undefined;
          throw err;
        })
        .then((caps) => {
          Object.freeze(caps.simulate);
          if (caps.query) Object.freeze(caps.query);
          return Object.freeze(caps);
        });
    }
    return this.capabilitiesResult;
  }

  /**
   * Whether the node has time travel (`EnableTimeTravel`): reads at past
   * rounds, the `...Versions` methods and simulate at any round since
   * genesis. It is the `timeTravel` of {@link DTAlgodClient.capabilities},
   * so it costs no request once they are cached, and is false on stock
   * algod. Errors, such as network failures, are rethrown and not cached.
   *
   * A node with time travel whose history is not trusted yet answers reads at
   * past rounds with a 503 that `isHistoryUnavailable` recognizes.
   *
   * #### Example
   * ```typescript
   * if (!(await algodClient.supportsDT())) {
   *   // fall back to an indexer
   * }
   * ```
   */
  async supportsDT(): Promise<boolean> {
    return (await this.capabilities()).timeTravel;
  }

  /**
   * Whether the node can list asset holders ({@link DTAlgodClient.getAssetHolders}):
   * it has time travel and the asset holders index (`TimeTravelHoldersIndex`).
   * The limits do not report the index, so a node with time travel is probed
   * with a holders request that it rejects without reading anything
   * (`limit=0`). The answer is cached on the client. Errors, such as network
   * failures or a 503 for history that is not served, are rethrown and not
   * cached.
   *
   * A node whose index is on but not built yet still says yes here, and
   * answers `getAssetHolders` with a 503 that `isHistoryUnavailable`
   * recognizes.
   *
   * #### Example
   * ```typescript
   * if (await algodClient.supportsAssetHolders()) {
   *   for await (const h of algodClient.getAssetHolders(assetId).iterate()) {
   *     console.log(h.address, h.amount);
   *   }
   * }
   * ```
   */
  supportsAssetHolders(): Promise<boolean> {
    if (!this.supportsAssetHoldersResult) {
      this.supportsAssetHoldersResult = this.supportsDT()
        .then(async (timeTravel) => {
          if (!timeTravel) return false;
          try {
            await this.getAssetHolders(0).limit(0).do();
            return true;
          } catch (err) {
            if (err instanceof DTUnsupportedError) return false;
            // The node checks the index before the limit, so rejecting the
            // limit means the index is on.
            if ((err as { status?: number }).status === 400) return true;
            throw err;
          }
        })
        .catch((err) => {
          this.supportsAssetHoldersResult = undefined;
          throw err;
        });
    }
    return this.supportsAssetHoldersResult;
  }
}
