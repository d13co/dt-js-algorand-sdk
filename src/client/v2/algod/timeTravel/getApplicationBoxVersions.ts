import { bytesToBase64 } from '../../../../encoding/binarydata.js';
import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeJSON } from '../../../../encoding/encoding.js';
import VersionsRequest from './versionsRequest.js';
import { BoxVersion, BoxVersionsResponse } from './models.js';

/**
 * Given an application ID and a box name, list the rounds at which the box was
 * created, written or deleted. Requires a time-travel algod.
 *
 * A version is a round, not a transaction: several writes in one round make a
 * single version holding the value at the end of that round, and a write that
 * leaves the bytes the same is not a version. A deletion is a version with
 * `deleted: true` and no value. A box that never existed in the range has no
 * versions (not a 404).
 *
 * #### Example
 * ```typescript
 * const res = await algodClient
 *   .getApplicationBoxVersions(1234, new TextEncoder().encode('config'))
 *   .order('desc')
 *   .limit(10)
 *   .include('values')
 *   .do();
 * ```
 *
 * @param index - The application ID to look up.
 * @param name - The box name.
 * @category GET
 */
export default class GetApplicationBoxVersions extends VersionsRequest<
  BoxVersion,
  BoxVersionsResponse
> {
  private index: bigint;

  constructor(c: HTTPClient, index: number | bigint, name: Uint8Array) {
    super(c);
    this.index = BigInt(index);
    this.query.name = `b64:${bytesToBase64(name)}`;
  }

  /**
   * @returns `/v2/applications/${index}/box/versions`
   */
  path() {
    return `/v2/applications/${this.index}/box/versions`;
  }

  // eslint-disable-next-line class-methods-use-this
  prepare(response: HTTPClientResponse): BoxVersionsResponse {
    return decodeJSON(response.getJSONText(), BoxVersionsResponse);
  }
}
