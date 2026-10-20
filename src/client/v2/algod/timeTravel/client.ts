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
import GetApplicationVersions from './getApplicationVersions.js';
import GetApplicationBoxByNameAt from './getApplicationBoxByNameAt.js';
import GetApplicationBoxesAt from './getApplicationBoxesAt.js';
import GetApplicationBoxVersions from './getApplicationBoxVersions.js';
import GetApplicationBoxesVersions from './getApplicationBoxesVersions.js';
import SimulateTransactionsAt from './simulateTransactionsAt.js';
import { TimeTravelUnsupportedError } from './errors.js';
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
 * const algodClient = new algosdk.TimeTravelAlgodClient(token, server, port);
 * const box = await algodClient
 *   .getApplicationBoxByName(1234, boxName)
 *   .round(45000000)
 *   .do();
 * ```
 */
export class TimeTravelAlgodClient extends AlgodClient {
  /**
   * What this build of the client supports, for code that finds
   * `TimeTravelAlgodClient` at runtime on an algosdk that may be stock or an
   * older fork build:
   * - `reads-at-round`: `.round()` on the account, asset, application, box and
   *   supply reads;
   * - `versions`: the `...Versions` methods;
   * - `simulate-groups`, `parallel-groups`, `simulate-rounds`: several groups,
   *   `parallelGroups()` and `rounds()` in `simulateTransactions`;
   * - `from`: {@link TimeTravelAlgodClient.from};
   * - `group-results`: `groupResult()` / `groupResults()` on the simulate
   *   response;
   * - `from-transactions`: `TimeTravelSimulateRequest.fromTransactions`;
   * - `pack-rounds`: `packSimulateRounds`.
   *
   * #### Example
   * ```typescript
   * const TT = (algosdk as any).TimeTravelAlgodClient;
   * if (TT?.features?.includes('group-results')) {
   *   const client = TT.from(algod);
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
  ]);

  /** The clients made by {@link TimeTravelAlgodClient.from}, by source client. */
  private static fromCache = new WeakMap<object, TimeTravelAlgodClient>();

  /**
   * A `TimeTravelAlgodClient` that sends its requests through an existing
   * {@link AlgodClient}'s HTTP client: same server, token, headers and custom
   * `BaseHTTPClient`, if any. Returns `algod` itself if it already is a
   * `TimeTravelAlgodClient`. Calling it again with the same client returns
   * the same `TimeTravelAlgodClient`, so what it caches, such as
   * `supportsTimeTravel()`, is kept.
   *
   * `algod` may come from another copy of algosdk (it is read by shape, not
   * `instanceof`), but transactions and models passed to this client must come
   * from this copy, so make the app use a single copy.
   *
   * #### Example
   * ```typescript
   * const algodClient = algosdk.TimeTravelAlgodClient.from(
   *   algorand.client.algod
   * );
   * ```
   *
   * @param algod - The client to share the connection of.
   * @throws TypeError if `algod` is not shaped like an `AlgodClient`.
   */
  static from(algod: AlgodClient | { c: unknown }): TimeTravelAlgodClient {
    if (algod instanceof TimeTravelAlgodClient) return algod;
    const cached = TimeTravelAlgodClient.fromCache.get(algod);
    if (cached) return cached;
    const bc = (algod as unknown as { c?: { bc?: Partial<BaseHTTPClient> } })?.c
      ?.bc;
    if (
      typeof bc?.get !== 'function' ||
      typeof bc.post !== 'function' ||
      typeof bc.delete !== 'function'
    ) {
      throw new TypeError(
        'TimeTravelAlgodClient.from expects an AlgodClient: found no HTTP client with get, post and delete on it'
      );
    }
    const client = new TimeTravelAlgodClient(bc as BaseHTTPClient, '');
    TimeTravelAlgodClient.fromCache.set(algod, client);
    return client;
  }

  private supportsTimeTravelResult?: Promise<boolean>;

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
   * The response does not say which round it is for, so unlike the other
   * reads, a stock algod that ignores `.round()` cannot be detected here: it
   * answers with the latest asset. Check `supportsTimeTravel()` first.
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
   * The response does not say which round it is for, so unlike the other
   * reads, a stock algod that ignores `.round()` cannot be detected here: it
   * answers with the latest application. Check `supportsTimeTravel()` first.
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
   * `supportsTimeTravel()` probes the single-box versions route, so a
   * time-travel node built before this endpoint passes it, then answers this
   * one with a 404, thrown as a {@link TimeTravelUnsupportedError}.
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
   *   `MaxAPISimulateGroups` (default 16). By default they run in order as
   *   consecutive groups of one simulated block: each group sees the effects
   *   of the groups before it, a transaction or lease used by an earlier group
   *   is a duplicate, and the groups share the block's byte limit, so a group
   *   that does not fit fails while a smaller later group may still fit. A
   *   group that fails is rolled back and the later groups still run, except
   *   after a failed post-evaluation check (placeholder PQ signatures with
   *   `fixSigners`) or a corrupted evaluator: every later group is then
   *   reported as not simulated. Each group's failure is in its own
   *   `failureMessage` / `failedAt` (0-based). `extraOpcodeBudget` applies to
   *   each group.
   * - With `.parallelGroups()` (or `parallelGroups` on a
   *   {@link TimeTravelSimulateRequest}), every group is simulated alone
   *   against the state at the start round, concurrently.
   * - With `.rounds([...])` (or `rounds` on a
   *   {@link TimeTravelSimulateRequest}), the request is simulated once per
   *   listed round (0 is the latest), and the results are in `roundResults`,
   *   one per entry in request order. A round that cannot be simulated has an
   *   `error` in its entry instead of failing the request. The top-level
   *   `lastRound` is then 0 and `txnGroups` is empty. With a time-travel node
   *   (`EnableTimeTravel`) any round since genesis can be listed; otherwise
   *   only the node's last few rounds. `AtomicTransactionComposer.simulate`
   *   reads the top-level `txnGroups`, so use the client directly for this.
   *
   * The node may also raise the limits on unnamed resources
   * (`allowUnnamedResources`) with its `SimulateResourceLimitMultiplier`
   * setting. The resources it then reports may not fit in a group that can be
   * submitted.
   *
   * A stock node's rejection of several groups, `parallelGroups` or `rounds`
   * is thrown as a {@link TimeTravelUnsupportedError}, as is a response
   * without one round result per listed round, each for the round asked for.
   *
   * #### Example
   * ```typescript
   * const request = new algosdk.timeTravelModels.TimeTravelSimulateRequest({
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
   * ```
   *
   * @param request - The simulate request. A {@link TimeTravelSimulateRequest}
   * can set the fork's fields.
   * @category POST
   */
  simulateTransactions(request: SimulateRequest) {
    return new SimulateTransactionsAt(this.c, request);
  }

  /**
   * Simulate signed transactions given as msgpack bytes. Several groups can be
   * passed as an array of arrays, one array per group; see
   * {@link TimeTravelAlgodClient.simulateTransactions} for how they run.
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
   * Whether the node has time travel, found by probing a `/versions` route,
   * which only exists with `EnableTimeTravel`. A
   * {@link TimeTravelUnsupportedError} (route missing, or no history) means
   * no; a response, or any other 400 (the route exists but rejected the
   * probe), means yes. The answer is cached on the client. Other errors, such
   * as network failures, are rethrown and not cached.
   *
   * #### Example
   * ```typescript
   * if (!(await algodClient.supportsTimeTravel())) {
   *   // fall back to an indexer
   * }
   * ```
   */
  supportsTimeTravel(): Promise<boolean> {
    if (!this.supportsTimeTravelResult) {
      this.supportsTimeTravelResult = this.getApplicationBoxVersions(
        0,
        new Uint8Array([0])
      )
        .limit(1)
        .do()
        .then(
          () => true,
          (err) => {
            if (err instanceof TimeTravelUnsupportedError) return false;
            // The route exists but rejected the probe's parameters.
            if ((err as { status?: number }).status === 400) return true;
            this.supportsTimeTravelResult = undefined;
            throw err;
          }
        );
    }
    return this.supportsTimeTravelResult;
  }
}
