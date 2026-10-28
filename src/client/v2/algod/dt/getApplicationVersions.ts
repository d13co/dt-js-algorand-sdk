import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeDTJSON } from './json.js';
import VersionsRequest from './versionsRequest.js';
import { ApplicationVersion, ApplicationVersionsResponse } from './models.js';

/**
 * Given an application ID, list the rounds at which the application's
 * parameters changed, including its creation and deletion.
 * Requires a time-travel algod.
 *
 * Versions are the rounds at which the stored value changed: a write of an
 * identical value is not a version, a deletion is.
 *
 * @category GET
 */
export default class GetApplicationVersions extends VersionsRequest<
  ApplicationVersion,
  ApplicationVersionsResponse
> {
  private index: bigint;

  constructor(c: HTTPClient, index: number | bigint) {
    super(c);
    this.index = BigInt(index);
  }

  /**
   * @returns `/v2/applications/${index}/versions`
   */
  path() {
    return `/v2/applications/${this.index}/versions`;
  }

  // eslint-disable-next-line class-methods-use-this
  prepare(response: HTTPClientResponse): ApplicationVersionsResponse {
    return decodeDTJSON(response.getJSONText(), ApplicationVersionsResponse);
  }
}
