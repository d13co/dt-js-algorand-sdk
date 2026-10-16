import { HTTPClientResponse } from '../../../client.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import GetApplicationBoxes from '../getApplicationBoxes.js';
import { BoxesResponse } from '../models/types.js';
import { checkRound, readAtRound } from './errors.js';

/**
 * {@link GetApplicationBoxes} whose `round` works at any past round on a
 * time-travel algod, and is checked against the response.
 *
 * Without time travel, algod keeps only its last few rounds (`MaxAcctLookback`,
 * default 4) and answers 400 `given round is no longer available` for older
 * ones, which is thrown as a {@link TimeTravelUnsupportedError}.
 */
export default class GetApplicationBoxesAt extends GetApplicationBoxes {
  private requestedRound?: bigint;

  /**
   * Return the boxes as of the end of this round instead of the latest round.
   * Pass the same round on every page: past rounds never change, so the pages
   * fit together.
   *
   * Listing a past round walks every box the app has ever had under the
   * prefix, deleted ones included; use `prefix` to narrow it.
   *
   * @param round - The round to list the boxes at.
   * @category query
   */
  round(round: number | bigint) {
    this.requestedRound = ensureBigInt(round);
    // A string, so that round 0 isn't dropped as falsy.
    this.query.round = this.requestedRound.toString();
    return this;
  }

  /**
   * Pagination token returned by the previous call, as its `nextToken`.
   *
   * The cursor is exclusive: only boxes whose names sort strictly after it are
   * returned. (Upstream's OpenAPI description, "the earliest box name to
   * include", is wrong.) The token is a box name in the goal app call arg form.
   *
   * @param nextToken - The previous page's `nextToken`.
   * @category query
   */
  next(nextToken: string | undefined) {
    return super.next(nextToken);
  }

  prepare(response: HTTPClientResponse): BoxesResponse {
    const boxes = super.prepare(response);
    checkRound(this.requestedRound, boxes.round, response);
    return boxes;
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
