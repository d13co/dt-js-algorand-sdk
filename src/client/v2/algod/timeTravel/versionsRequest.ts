import JSONRequest from '../../jsonrequest.js';
import { HTTPClientResponse } from '../../../client.js';
import { Query } from '../../../baseHTTPClient.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import {
  isMissingVersionsRoute,
  TimeTravelUnsupportedError,
} from './errors.js';

export type VersionsOrder = 'asc' | 'desc';
export type VersionsInclude = 'values';

/**
 * Base class for the `/versions` endpoints of a time-travel algod. Each lists
 * the rounds at which an object changed over an inclusive round range, a page
 * at a time.
 *
 * On a node without time travel the routes don't exist (they are only
 * registered with `EnableTimeTravel`), which is thrown as a
 * {@link TimeTravelUnsupportedError} with the HTTP error as its `cause`. The endpoints never 404 otherwise: an
 * object that never existed in the range has no versions.
 */
export default abstract class VersionsRequest<
  Entry,
  Response extends { versions: Entry[]; nextToken?: string },
> extends JSONRequest<Response> {
  /**
   * Include versions at this round or later. Defaults to 0.
   *
   * @param round - The first round of the range.
   * @category query
   */
  minRound(round: number | bigint) {
    // Rounds go in as strings so that round 0 isn't dropped as falsy.
    this.query['min-round'] = ensureBigInt(round).toString();
    return this;
  }

  /**
   * Include versions at this round or earlier. Defaults to the latest round.
   * A page requested with an explicit `maxRound` never changes and can be
   * cached.
   *
   * @param round - The last round of the range.
   * @category query
   */
  maxRound(round: number | bigint) {
    this.query['max-round'] = ensureBigInt(round).toString();
    return this;
  }

  /**
   * List versions oldest first (`asc`, the default) or newest first (`desc`).
   * For "the last N changes", use `.order('desc').limit(N)`.
   *
   * @param order - `asc` or `desc`
   * @category query
   */
  order(order: VersionsOrder) {
    this.query.order = order;
    return this;
  }

  /**
   * Versions per page: default 100, at most 10,000, or 1,000 with
   * `include('values')`. A page also ends once its values reach 1 MB, so a
   * short page does not mean there are no more: only a missing `nextToken`
   * does.
   *
   * @param limit - Maximum number of versions per page.
   * @category query
   */
  limit(limit: number) {
    // A string, so that 0 is sent (and rejected) rather than dropped.
    this.query.limit = limit.toString();
    return this;
  }

  /**
   * The `nextToken` of the previous page. Pass it back unchanged, along with
   * the same other parameters. It stays valid as new blocks arrive.
   *
   * @param nextToken - The previous page's `nextToken`.
   * @category query
   */
  next(nextToken: string | undefined) {
    this.query.next = nextToken;
    return this;
  }

  /**
   * Include additional items in the response. Use `values` to include each
   * version's new value (absent on deletions).
   *
   * @param include - The additional items to include in the response.
   * @category query
   */
  include(...include: VersionsInclude[]) {
    this.query.include = include.join(',');
    return this;
  }

  protected executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    return this.getPage(this.query, headers, customOptions);
  }

  /**
   * Iterate over every version in the range, fetching pages as needed until a
   * page has no `nextToken`. The builder's own query is not modified, so the
   * request can be reused.
   *
   * #### Example
   * ```typescript
   * for await (const version of algodClient
   *   .getApplicationBoxVersions(1234, boxName)
   *   .include('values')
   *   .iterate()) {
   *   console.log(version.round, version.deleted, version.value);
   * }
   * ```
   *
   * @param headers - Additional headers to send in each request. Optional.
   * @param customOptions - Additional options to pass to the underlying BaseHTTPClient. Optional.
   */
  async *iterate(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): AsyncGenerator<Entry, void, undefined> {
    const query = { ...this.query };
    for (;;) {
      // HTTPClient drops empty values from the query object it is given, so
      // each page gets its own copy.
      // Each page needs the previous page's next-token.
      // eslint-disable-next-line no-await-in-loop
      const res = await this.getPage({ ...query }, headers, customOptions);
      const page = this.prepare(res);
      yield* page.versions;
      if (!page.nextToken) return;
      query.next = page.nextToken;
    }
  }

  private async getPage(
    query: Query<any>,
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    try {
      return await this.c.get({
        relativePath: this.path(),
        query,
        requestHeaders: headers,
        customOptions,
      });
    } catch (err) {
      if (isMissingVersionsRoute(err)) {
        throw new TimeTravelUnsupportedError(
          `${this.path()} does not exist: the node does not have time travel (EnableTimeTravel)`,
          { cause: err }
        );
      }
      throw err;
    }
  }
}
