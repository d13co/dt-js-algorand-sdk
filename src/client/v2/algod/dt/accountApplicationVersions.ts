import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeDTJSON } from './json.js';
import { Address } from '../../../../encoding/address.js';
import VersionsRequest, {
  StateVersionsInclude,
  encodeVersionsFilter,
} from './versionsRequest.js';
import { AccountVersion, AccountVersionsResponse } from './models.js';

/**
 * Given an account and an application, list the rounds at which the
 * account's local state for the application changed and, if the account
 * created the application, the application's parameters. Entries are those of
 * `accountVersions` restricted to that application.
 * Requires a time-travel algod.
 *
 * Versions are the rounds at which the stored value changed: a write of an
 * identical value is not a version, a deletion is.
 *
 * @category GET
 */
export default class AccountApplicationVersions extends VersionsRequest<
  AccountVersion,
  AccountVersionsResponse,
  StateVersionsInclude
> {
  private account: string;
  private applicationID: bigint;

  constructor(
    c: HTTPClient,
    account: string | Address,
    applicationID: number | bigint
  ) {
    super(c);
    this.account = account.toString();
    this.applicationID = BigInt(applicationID);
  }

  /**
   * @returns `/v2/accounts/${account}/applications/${applicationID}/versions`
   */
  path() {
    return `/v2/accounts/${this.account}/applications/${this.applicationID}/versions`;
  }

  /**
   * List only the versions at which this local state key's value changed:
   * added, removed, or given a new value or type, net over the round. Each
   * entry then has the local state only, never the application's parameters,
   * with the key's new value as `keyValue` (absent when the key was removed or
   * the local state deleted).
   *
   * There is no index of keys: a page examines at most 100,000 versions and
   * reads at most 64 MB, so it can hold fewer than `limit` versions, or none,
   * and still have a `nextToken`; `pages()` and `iterate()` keep going until
   * it is absent. Not with `rounds()` (rejected before sending).
   *
   * @param key - The local state key, as bytes (`new TextEncoder().encode('n')`
   * for a string key), at most 64 bytes. An empty key is allowed.
   * @category query
   */
  key(key: Uint8Array) {
    this.query.key = encodeVersionsFilter('key', key);
    return this;
  }

  /**
   * With `include('keys')`, a local state that exists must have
   * `changedKeys`, even an empty list. Created applications are not checked:
   * they have none with `exclude('created-apps-params')`.
   */
  // eslint-disable-next-line class-methods-use-this
  protected keysIgnored(page: AccountVersionsResponse): boolean {
    return page.versions.some((v) =>
      (v.appsLocalState ?? []).some(
        (ls) => !ls.deleted && ls.changedKeys === undefined
      )
    );
  }

  prepare(response: HTTPClientResponse): AccountVersionsResponse {
    return this.checkPage(
      decodeDTJSON(response.getJSONText(), AccountVersionsResponse)
    );
  }
}
