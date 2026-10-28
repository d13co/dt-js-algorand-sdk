import JSONRequest from '../../jsonrequest.js';
import { HTTPClientResponse } from '../../../client.js';
import { Query } from '../../../baseHTTPClient.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import {
  describe,
  isMissingVersionsRoute,
  DTUnsupportedError,
} from './errors.js';
import { pageThrough } from './paging.js';

export type VersionsOrder = 'asc' | 'desc';
export type VersionsInclude = 'values';

/**
 * What the versions of application state (`getApplicationVersions`,
 * `accountVersions`, `accountApplicationVersions`) can include: `values`, and
 * `keys` for the state keys each version changed (`changedKeys`).
 */
export type StateVersionsInclude = 'values' | 'keys';

/** The most distinct rounds one `rounds()` request may list. */
export const MAX_VERSIONS_ROUNDS = 10_000;

/**
 * Base class for the `/versions` endpoints of a time-travel algod. Each lists
 * the rounds at which an object changed over an inclusive round range, a page
 * at a time, or with `rounds()` the object as of each listed round.
 *
 * On a node without time travel the routes don't exist (they are only
 * registered with `EnableTimeTravel`), which is thrown as a
 * {@link DTUnsupportedError} with the HTTP error as its `cause`. The endpoints never 404 otherwise: an
 * object that never existed in the range has no versions.
 */
export default abstract class VersionsRequest<
  Entry extends { round: bigint },
  Response extends { round: bigint; versions: Entry[]; nextToken?: string },
  Include extends string = VersionsInclude,
> extends JSONRequest<Response> {
  /** The rounds of `rounds()`, deduplicated, to check the answer against. */
  protected requestedRounds?: Set<bigint>;

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
   * Instead of the versions in a range, list the object as of each of these
   * rounds: one entry per round, for the state at the end of that round, with
   * the round of the change in effect as `changedRound`. Use it to sample an
   * object's history (a chart, a balance at month ends) in one request instead
   * of one read per round.
   *
   * - Entries are deduplicated and listed in `order` (ascending by default),
   *   not in the order given here: match them by `round`.
   * - An entry for a round at which the object did not exist has
   *   `deleted: true` and no `changedRound`. On the account endpoints, an
   *   object that did not exist then is left out of the entry.
   * - **Round 0 is the genesis round here**, unlike the `rounds` of simulate and
   *   query, where 0 means the latest round. A round after the latest one is
   *   a 400.
   * - At most {@link MAX_VERSIONS_ROUNDS} (10,000) distinct rounds, and not
   *   with `minRound` / `maxRound`: both are rejected before sending.
   * - `limit` counts rounds, and `nextToken` is the next requested round, so
   *   `pages()` / `iterate()` work as usual.
   * - The rounds go in the URL, about 9 bytes each: 10,000 rounds make a 90 KB
   *   URL, beyond the header limits of many proxies. Split long lists into
   *   several requests.
   *
   * A node that ignores `rounds` (dt-algorand `v5.0.4-dt3` and older) answers
   * with range versions instead; the client sees entries for rounds it did
   * not ask for, or none, and throws a {@link DTUnsupportedError}.
   *
   * #### Example
   * ```typescript
   * const res = await algodClient
   *   .getAssetVersions(31566704)
   *   .rounds([1000, 60_000_000])
   *   .do();
   * for (const v of res.versions) {
   *   console.log(v.round, v.deleted ? 'absent' : `as of ${v.changedRound}`);
   * }
   * ```
   *
   * @param rounds - The rounds, at least one.
   * @category query
   */
  rounds(rounds: readonly (number | bigint)[]) {
    if (rounds.length === 0) {
      throw new Error('rounds needs at least one round');
    }
    const set = new Set(rounds.map((r) => ensureBigInt(r)));
    this.requestedRounds = set;
    this.query.rounds = Array.from(set, (r) => r.toString()).join(',');
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
   * Versions per page (with `rounds`, rounds per page): default 100, at most
   * 10,000, or 1,000 with `include('values')` or `include('keys')`. A page
   * also ends early once its values reach 1 MB, before 100,000 lookups with
   * `rounds`, and on newer builds at a 64 MB read budget, so a short page does
   * not mean there are no more: only a missing `nextToken` does.
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
   * version's new value (absent on deletions). On the application state
   * endpoints, use `keys` to list the state keys each version changed
   * (`changedKeys`). A node that does not know `keys` (dt-algorand
   * `v5.0.4-dt3` and older) rejects it, thrown as a
   * {@link DTUnsupportedError}.
   *
   * @param include - The additional items to include in the response.
   * @category query
   */
  include(...include: Include[]) {
    this.query.include = include.join(',');
    return this;
  }

  /**
   * Why the request would be rejected as a whole, or undefined. Checked
   * before sending, for a clearer error than the node's.
   */
  protected invalidReason(): string | undefined {
    const rounds = this.requestedRounds;
    if (!rounds) return undefined;
    if (
      this.query['min-round'] !== undefined ||
      this.query['max-round'] !== undefined
    ) {
      return 'rounds cannot be combined with minRound or maxRound';
    }
    if (rounds.size > MAX_VERSIONS_ROUNDS) {
      return `rounds lists ${rounds.size} distinct rounds, more than the ${MAX_VERSIONS_ROUNDS} a request may have`;
    }
    return undefined;
  }

  /** Whether `include('keys')` was set. */
  protected includesKeys() {
    return (
      typeof this.query.include === 'string' &&
      this.query.include.split(',').includes('keys')
    );
  }

  /**
   * Whether a page answered with `include('keys')` lacks the changed keys
   * where they must be: the node ignored `keys`. Only the application state
   * endpoints override it.
   */
  // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-unused-vars
  protected keysIgnored(_page: Response): boolean {
    return false;
  }

  /**
   * Checks that a decoded page applied `rounds` and `include('keys')`, and
   * throws a {@link DTUnsupportedError} if it did not. Each builder's
   * `prepare` calls it.
   *
   * With `rounds`, every entry must be for a requested round, and a page
   * cannot be empty: rounds mode gives one entry per round, even for an object
   * that did not exist then. A node without `rounds` drops the parameter and
   * answers with range versions.
   *
   * @param page - The decoded page.
   */
  protected checkPage(page: Response): Response {
    const rounds = this.requestedRounds;
    if (rounds) {
      if (page.versions.length === 0) {
        throw new DTUnsupportedError(
          `${this.path()} answered rounds with no entries; the node ignored rounds and does not support versions as of rounds`
        );
      }
      const stray = page.versions.find((v) => !rounds.has(v.round));
      if (stray) {
        throw new DTUnsupportedError(
          `${this.path()} answered an entry for round ${stray.round}, which was not requested; the node ignored rounds and does not support versions as of rounds`,
          { returnedRound: stray.round }
        );
      }
    }
    if (this.includesKeys() && this.keysIgnored(page)) {
      throw new DTUnsupportedError(
        `${this.path()} answered include=keys without changed-keys; the node ignored keys and does not support them`
      );
    }
    return page;
  }

  protected executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    const reason = this.invalidReason();
    if (reason !== undefined) return Promise.reject(new Error(reason));
    return this.getPage(this.query, headers, customOptions);
  }

  /**
   * Fetch every page, until a page has no `nextToken`. Pages may be short, or
   * even empty, and still have a `nextToken`; they are all yielded. The
   * builder's own query is not modified, so the request can be reused. A node
   * that answers with the token it was sent throws an `Error`, rather than
   * paging forever.
   *
   * #### Example
   * ```typescript
   * for await (const page of algodClient
   *   .getApplicationVersions(1234)
   *   .order('desc')
   *   .limit(1000)
   *   .pages()) {
   *   console.log(page.round, page.versions.length, page.nextToken);
   * }
   * ```
   *
   * @param headers - Additional headers to send in each request. Optional.
   * @param customOptions - Additional options to pass to the underlying BaseHTTPClient. Optional.
   */
  async *pages(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): AsyncGenerator<Response, void, undefined> {
    const reason = this.invalidReason();
    if (reason !== undefined) throw new Error(reason);
    yield* pageThrough(
      this.query,
      async (query) =>
        this.prepare(await this.getPage(query, headers, customOptions)),
      this.path()
    );
  }

  /**
   * Iterate over every version in the range, fetching pages as needed until a
   * page has no `nextToken` (see `pages()`). The builder's own query is not
   * modified, so the request can be reused.
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
    for await (const page of this.pages(headers, customOptions)) {
      yield* page.versions;
    }
  }

  protected async getPage(
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
        throw new DTUnsupportedError(
          `${this.path()} does not exist: the node does not have time travel (EnableTimeTravel)`,
          { cause: err }
        );
      }
      const { status, text } = describe(err);
      if (status === 400 && /invalid include value: keys/.test(text)) {
        throw new DTUnsupportedError(
          `${this.path()} rejected include=keys: the node does not support the changed keys of application state`,
          { cause: err }
        );
      }
      throw err;
    }
  }
}
