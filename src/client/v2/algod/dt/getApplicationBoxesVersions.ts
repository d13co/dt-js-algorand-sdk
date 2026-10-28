import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeDTJSON } from './json.js';
import VersionsRequest, { encodeVersionsFilter } from './versionsRequest.js';
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

  /**
   * List only the changes of the boxes whose names start with this prefix,
   * such as one ARC-56 box map. Rounds in which none of them changed are left
   * out. A prefix equal to a whole name also matches the longer names that
   * start with it: for one box, use `getApplicationBoxVersions`.
   *
   * Without `rounds()`, a page steps through every box index entry of the
   * application in its rounds, at most 1,000,000 of them, so it can hold
   * fewer than `limit` versions, or none, and still have a `nextToken`;
   * `pages()` and `iterate()` keep going until it is absent. With `rounds()`,
   * only the boxes under the prefix are merged, so the node's per-round box
   * limit counts only those.
   *
   * @param prefix - The box name prefix, as bytes, 1 to 64 bytes.
   * @category query
   */
  prefix(prefix: Uint8Array) {
    if (prefix instanceof Uint8Array && prefix.length === 0) {
      throw new Error('prefix is empty: list every box without it');
    }
    this.query.prefix = encodeVersionsFilter('prefix', prefix);
    return this;
  }

  prepare(response: HTTPClientResponse): BoxesVersionsResponse {
    return this.checkPage(
      decodeDTJSON(response.getJSONText(), BoxesVersionsResponse)
    );
  }
}
