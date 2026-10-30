import { HTTPClientResponse } from '../../../client.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import Supply from '../supply.js';
import { readAtRound } from './errors.js';

/**
 * {@link Supply} with `round`: the supply as of the end of a past round.
 * Requires a time-travel algod.
 */
export default class SupplyAt extends Supply {
  private requestedRound?: bigint;

  /**
   * Answer as of the end of this round instead of the latest round.
   *
   * A node with time travel off rejects `round`, even the latest one, which is
   * thrown as a {@link DTUnsupportedError}. Stock algod ignores it and answers
   * as of its latest round, without the `X-Algod-TT-Round` header that marks an
   * answer (or a 404) given as of the round asked for: that is thrown as a
   * {@link DTUnsupportedError} too, so check `supportsDT()` first.
   *
   * A round whose online stake the history does not record is a 404 (the
   * time travel history does not record this online stake).
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
