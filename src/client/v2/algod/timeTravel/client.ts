import { AlgodClient } from '../algod.js';
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
import { TimeTravelUnsupportedError } from './errors.js';

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
