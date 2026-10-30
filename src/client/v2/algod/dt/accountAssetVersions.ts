import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeDTJSON } from './json.js';
import { Address } from '../../../../encoding/address.js';
import VersionsRequest from './versionsRequest.js';
import { AccountVersion, AccountVersionsResponse } from './models.js';

/**
 * Given an account and an asset, list the rounds at which the account's
 * holding of the asset changed and, if the account created the asset, the
 * asset's parameters. Entries are those of `accountVersions` restricted to
 * that asset.
 * Requires a time-travel algod.
 *
 * Versions are the rounds at which the stored value changed: a write of an
 * identical value is not a version, a deletion is.
 *
 * @category GET
 */
export default class AccountAssetVersions extends VersionsRequest<
  AccountVersion,
  AccountVersionsResponse
> {
  private account: string;
  private assetID: bigint;

  constructor(
    c: HTTPClient,
    account: string | Address,
    assetID: number | bigint
  ) {
    super(c);
    this.account = account.toString();
    this.assetID = BigInt(assetID);
  }

  /**
   * @returns `/v2/accounts/${account}/assets/${assetID}/versions`
   */
  path() {
    return `/v2/accounts/${this.account}/assets/${this.assetID}/versions`;
  }

  // eslint-disable-next-line class-methods-use-this
  prepare(response: HTTPClientResponse): AccountVersionsResponse {
    return decodeDTJSON(response.getJSONText(), AccountVersionsResponse);
  }
}
