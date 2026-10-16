import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeJSON } from '../../../../encoding/encoding.js';
import { Address } from '../../../../encoding/address.js';
import VersionsRequest from './versionsRequest.js';
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
  AccountVersionsResponse
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

  // eslint-disable-next-line class-methods-use-this
  prepare(response: HTTPClientResponse): AccountVersionsResponse {
    return decodeJSON(response.getJSONText(), AccountVersionsResponse);
  }
}
