import { HTTPClientResponse } from '../../../client.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import GetAssetByID from '../getAssetByID.js';
import { readAtRound } from './errors.js';

/**
 * {@link GetAssetByID} with `round`: an asset as of the end of a past round.
 * Requires a time-travel algod.
 */
export default class GetAssetByIDAt extends GetAssetByID {
  private requestedRound?: bigint;

  /**
   * Answer as of the end of this round instead of the latest round.
   *
   * The response does not say which round it is for, so it cannot be checked:
   * stock algod ignores this parameter and answers for the latest round. Use
   * `supportsDT()` to find out whether the node has time travel. A
   * time-travel build without `EnableTimeTravel` rejects the round, which is
   * thrown as a {@link DTUnsupportedError}.
   *
   * @param round - The round to answer at.
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
