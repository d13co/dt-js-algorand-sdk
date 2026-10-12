import { AlgodClient } from '../algod.js';
import GetApplicationBoxByNameAt from './getApplicationBoxByNameAt.js';
import GetApplicationBoxesAt from './getApplicationBoxesAt.js';
import GetApplicationBoxVersions from './getApplicationBoxVersions.js';
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
   * Whether the node has time travel, found by probing a `/versions` route,
   * which only exists with `EnableTimeTravel`. The answer is cached on the
   * client; errors other than the route being missing are rethrown and not
   * cached.
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
