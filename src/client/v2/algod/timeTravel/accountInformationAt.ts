import { HTTPClientResponse } from '../../../client.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import AccountInformation from '../accountInformation.js';
import { Account } from '../models/types.js';
import { checkRound, readAtRound } from './errors.js';

/**
 * {@link AccountInformation} with `round`: account information as of the end of a past round.
 * Requires a time-travel algod.
 */
export default class AccountInformationAt extends AccountInformation {
  private requestedRound?: bigint;

  /**
   * Answer as of the end of this round instead of the latest round.
   *
   * Stock algod ignores this parameter and answers for the latest round, so
   * the response is checked: a response for a different round throws a
   * {@link TimeTravelUnsupportedError}.
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

  prepare(response: HTTPClientResponse): Account {
    const data = super.prepare(response);
    checkRound(this.requestedRound, data.round, response);
    return data;
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

  /**
   * Execute the request, returning the response body as received. With
   * `round`, the response is also decoded to check its round.
   * @param headers - Additional headers to send in the request. Optional.
   * @param customOptions - Additional options to pass to the underlying BaseHTTPClient. Optional.
   */
  async doRaw(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<Uint8Array> {
    const res = await this.executeRequest(headers, customOptions);
    if (this.requestedRound !== undefined) this.prepare(res);
    return res.body;
  }
}
