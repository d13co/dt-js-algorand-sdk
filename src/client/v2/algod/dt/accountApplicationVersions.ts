import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeDTJSON } from './json.js';
import { Address } from '../../../../encoding/address.js';
import VersionsRequest, { StateVersionsInclude } from './versionsRequest.js';
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
