import { HTTPClientResponse } from '../../../client.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import GetApplicationBoxByName from '../getApplicationBoxByName.js';
import { Box } from '../models/types.js';
import { checkRound, readAtRound } from './errors.js';

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
   * Stock algod ignores this parameter and answers for the latest round, so
   * the response is checked: a response for a different round throws a
   * {@link DTUnsupportedError}.
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

  prepare(response: HTTPClientResponse): Box {
    const box = super.prepare(response);
    checkRound(this.requestedRound, box.round, response);
    return box;
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
