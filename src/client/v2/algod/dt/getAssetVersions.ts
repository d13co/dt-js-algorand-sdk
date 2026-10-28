import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeDTJSON } from './json.js';
import VersionsRequest from './versionsRequest.js';
import { AssetVersion, AssetVersionsResponse } from './models.js';

/**
 * Given an asset ID, list the rounds at which the asset's parameters
 * changed, including its creation and destruction.
 * Requires a time-travel algod.
 *
 * Versions are the rounds at which the stored value changed: a write of an
 * identical value is not a version, a deletion is.
 *
 * @category GET
 */
export default class GetAssetVersions extends VersionsRequest<
  AssetVersion,
  AssetVersionsResponse
> {
  private index: bigint;

  constructor(c: HTTPClient, index: number | bigint) {
    super(c);
    this.index = BigInt(index);
  }

  /**
   * @returns `/v2/assets/${index}/versions`
   */
  path() {
    return `/v2/assets/${this.index}/versions`;
  }

  prepare(response: HTTPClientResponse): AssetVersionsResponse {
    return this.checkPage(
      decodeDTJSON(response.getJSONText(), AssetVersionsResponse)
    );
  }
}
