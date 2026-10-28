import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeDTJSON } from './json.js';
import VersionsRequest from './versionsRequest.js';
import { BoxesVersion, BoxesVersionsResponse } from './models.js';

/**
 * Given an application ID, list the rounds at which any of its boxes changed,
 * with the boxes that did. Requires a time-travel algod.
 *
 * A version is a round, not a transaction: each lists the boxes created,
 * written or deleted in that round, in name order, and with `include('values')`
 * their values at the end of the round. A write that leaves the bytes the same
 * is not a change, nor is a box created and deleted within the round. Pages
 * never split a round.
 *
 * The node answers 503 when a page needs rounds from before its box index is
 * complete (a store written by an older build, before `ttimport -index-boxes`):
 * at once for an ascending range that starts before it, while a descending
 * range lists the later changes and fails on the page that would reach past
 * it. That 503 is thrown as the HTTP error.
 *
 * #### Example
 * ```typescript
 * for await (const version of algodClient
 *   .getApplicationBoxesVersions(1234)
 *   .order('desc')
 *   .include('values')
 *   .iterate()) {
 *   for (const box of version.boxes) {
 *     console.log(version.round, box.name, box.deleted, box.value);
 *   }
 * }
 * ```
 *
 * @param index - The application ID to look up.
 * @category GET
 */
export default class GetApplicationBoxesVersions extends VersionsRequest<
  BoxesVersion,
  BoxesVersionsResponse
> {
  private index: bigint;

  constructor(c: HTTPClient, index: number | bigint) {
    super(c);
    this.index = BigInt(index);
  }

  /**
   * @returns `/v2/applications/${index}/boxes/versions`
   */
  path() {
    return `/v2/applications/${this.index}/boxes/versions`;
  }

  prepare(response: HTTPClientResponse): BoxesVersionsResponse {
    return this.checkPage(
      decodeDTJSON(response.getJSONText(), BoxesVersionsResponse)
    );
  }
}
