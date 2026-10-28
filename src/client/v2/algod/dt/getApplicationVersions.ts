import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeDTJSON } from './json.js';
import VersionsRequest, {
  StateVersionsInclude,
  encodeVersionsFilter,
} from './versionsRequest.js';
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
  ApplicationVersionsResponse,
  StateVersionsInclude
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

  /**
   * List only the versions at which this global state key's value changed:
   * added, removed, or given a new value or type, net over the round (a key
   * set and deleted again, or set back to its old value, is not a change).
   * Each entry has the key's new value as `keyValue`, absent when the key was
   * removed or the application deleted.
   *
   * There is no index of keys: a page examines at most 100,000 versions and
   * reads at most 64 MB, so it can hold fewer than `limit` versions, or none,
   * and still have a `nextToken`; `pages()` and `iterate()` keep going until
   * it is absent. Not with `rounds()` (rejected before sending).
   *
   * #### Example
   * ```typescript
   * for await (const v of algodClient
   *   .getApplicationVersions(1284326447)
   *   .key(new TextEncoder().encode('total_effort'))
   *   .order('desc')
   *   .iterate()) {
   *   console.log(v.round, v.keyValue?.uint);
   * }
   * ```
   *
   * @param key - The global state key, as bytes, at most 64 bytes. An empty
   * key is allowed.
   * @category query
   */
  key(key: Uint8Array) {
    this.query.key = encodeVersionsFilter('key', key);
    return this;
  }

  /**
   * With `include('keys')`, an application version that is not a deletion
   * must have `changedKeys`, even an empty list.
   */
  // eslint-disable-next-line class-methods-use-this
  protected keysIgnored(page: ApplicationVersionsResponse): boolean {
    return page.versions.some((v) => !v.deleted && v.changedKeys === undefined);
  }

  prepare(response: HTTPClientResponse): ApplicationVersionsResponse {
    return this.checkPage(
      decodeDTJSON(response.getJSONText(), ApplicationVersionsResponse)
    );
  }
}
