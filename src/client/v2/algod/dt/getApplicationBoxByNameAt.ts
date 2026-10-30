import { HTTPClientResponse } from '../../../client.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import GetApplicationBoxByName from '../getApplicationBoxByName.js';
import { readAtRound } from './errors.js';

/**
 * {@link GetApplicationBoxByName} with `round`: read the box as it was at the
 * end of a past round. Requires a time-travel algod.
 *
 * A 404 means the box did not exist at that round (not created yet, or deleted
 * by then), or the app did not exist.
 */
export default class GetApplicationBoxByNameAt extends GetApplicationBoxByName {
  private requestedRound?: bigint;

  /**
   * Return the box as of the end of this round instead of the latest round.
   *
   * A node with time travel off rejects `round`, even the latest one, which is
   * thrown as a {@link DTUnsupportedError}. Stock algod ignores it and answers
   * for the latest round: check `supportsDT()` before relying on it.
   *
   * #### Example
   * ```typescript
   * const box = await algodClient
   *   .getApplicationBoxByName(1234, boxName)
   *   .round(45000000)
   *   .do();
   * ```
   *
   * @param round - The round to read the box at.
   * @category query
   */
  round(round: number | bigint) {
    this.requestedRound = ensureBigInt(round);
    // A string, so that round 0 isn't dropped as falsy.
    this.query.round = this.requestedRound.toString();
    return this;
  }

  protected executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    return readAtRound(
      this.requestedRound,
      super.executeRequest(headers, customOptions)
    );
  }
}
