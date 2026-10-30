import { HTTPClientResponse } from '../../../client.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import GetApplicationBoxes from '../getApplicationBoxes.js';
import { BoxesResponse } from '../models/types.js';
import { DTUnsupportedError, refusalAtRound } from './errors.js';

/**
 * {@link GetApplicationBoxes} whose `round` works at any past round on a
 * time-travel algod.
 *
 * With time travel off, algod keeps only its last few rounds (`MaxAcctLookback`,
 * default 4) and answers 400 `given round is no longer available` for older
 * ones, which is thrown as a {@link DTUnsupportedError}.
 *
 * Unlike the other reads at a round, the node may answer without
 * `X-Algod-TT-Round` (algod without time travel serves its last few rounds),
 * so the client checks the response's `round` instead: a page for another
 * round is thrown as a {@link DTUnsupportedError}. A node that lists no
 * boxes (`MaxAPIBoxPerApplication` 0) answers as of its latest round.
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

  protected executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    return refusalAtRound(
      this.requestedRound,
      super.executeRequest(headers, customOptions)
    );
  }

  prepare(response: HTTPClientResponse): BoxesResponse {
    const page = super.prepare(response);
    const requested = this.requestedRound;
    if (
      requested !== undefined &&
      (page.round === undefined || BigInt(page.round) !== requested)
    ) {
      throw new DTUnsupportedError(
        `Asked for the boxes at round ${requested} but the node answered for round ${page.round ?? 'unknown'}`,
        { requestedRound: requested }
      );
    }
    return page;
  }
}
