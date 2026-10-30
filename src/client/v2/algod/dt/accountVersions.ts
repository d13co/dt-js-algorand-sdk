import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { decodeDTJSON } from './json.js';
import { Address } from '../../../../encoding/address.js';
import VersionsRequest, { StateVersionsInclude } from './versionsRequest.js';
import { AccountVersion, AccountVersionsResponse } from './models.js';

export type AccountVersionsExclude =
  | 'all'
  | 'none'
  | 'created-apps-params'
  | 'created-assets-params';

/**
 * Given an account, list the rounds at which anything `accountInformation`
 * returns changed: the base record, asset holdings, application local states,
 * and the parameters of the assets and applications it created.
 * Requires a time-travel algod.
 *
 * Versions are the rounds at which the stored value changed: a write of an
 * identical value is not a version, a deletion is.
 *
 * Each version lists only the objects that changed in that round. Applying the
 * versions after `minRound`, replacing objects by id, to the account at
 * `minRound` (`accountInformation(address).round(minRound)`) gives the account
 * at any later round of the range. Amounts include pending rewards, which can
 * accrue between versions.
 *
 * @category GET
 */
export default class AccountVersions extends VersionsRequest<
  AccountVersion,
  AccountVersionsResponse,
  StateVersionsInclude
> {
  private account: string;

  constructor(c: HTTPClient, account: string | Address) {
    super(c);
    this.account = account.toString();
  }

  /**
   * @returns `/v2/accounts/${account}/versions`
   */
  path() {
    return `/v2/accounts/${this.account}/versions`;
  }

  /**
   * Exclude objects, as for `accountInformation`. Use `all` to list the
   * versions of the base record only. Use `created-apps-params` or
   * `created-assets-params` to list the creation and destruction of created
   * applications or assets but not the changes of their parameters. `all` and
   * `none` cannot be combined with other values. Defaults to `none`.
   *
   * @param exclude - The objects to exclude.
   * @category query
   */
  exclude(...exclude: AccountVersionsExclude[]) {
    this.query.exclude = exclude.join(',');
    return this;
  }

  /**
   * With `include('keys')`, a local state that exists must have
   * `changedKeys`, even an empty list. Created applications are not checked:
   * they have none with `exclude('created-apps-params')`.
   */
  // eslint-disable-next-line class-methods-use-this

  // eslint-disable-next-line class-methods-use-this
  prepare(response: HTTPClientResponse): AccountVersionsResponse {
    return decodeDTJSON(response.getJSONText(), AccountVersionsResponse);
  }
}
