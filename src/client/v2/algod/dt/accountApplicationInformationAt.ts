import { HTTPClientResponse } from '../../../client.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import AccountApplicationInformation from '../accountApplicationInformation.js';
import { readAtRound } from './errors.js';

/**
 * {@link AccountApplicationInformation} with `round`: an account's application local state as of the end of a past round.
 * Requires a time-travel algod.
 */
export default class AccountApplicationInformationAt extends AccountApplicationInformation {
  private requestedRound?: bigint;

  /**
   * Answer as of the end of this round instead of the latest round.
   *
   * A node with time travel off rejects `round`, even the latest one, which is
   * thrown as a {@link DTUnsupportedError}. Stock algod ignores it and answers
   * for the latest round: check `supportsDT()` before relying on it.
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
