import JSONRequest from '../../jsonrequest.js';
import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { Query } from '../../../baseHTTPClient.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import { describe, DTUnsupportedError, readAtRound } from './errors.js';
import { decodeDTJSON } from './json.js';
import { pageThrough } from './paging.js';
import { AssetHolder, AssetHoldersResponse } from './models.js';

/**
 * Why a dtalgod node that rejected a holders request does not serve holders,
 * or undefined if the error is about something else:
 * - a 404 without the handler's `asset does not exist`: the route is only
 *   registered with time travel on (`EnableTimeTravel`);
 * - a 400 from a node with time travel but the holders index off
 *   (`TimeTravelHoldersIndex`).
 */
export function holdersUnsupportedReason(err: unknown) {
  const { status, text } = describe(err);
  if (status === 404 && !/asset does not exist/.test(text)) {
    return 'it has time travel off (EnableTimeTravel)';
  }
  if (
    status === 400 &&
    /asset holders require EnableTimeTravel and TimeTravelHoldersIndex/.test(
      text
    )
  ) {
    return 'it has the asset holders index off (TimeTravelHoldersIndex)';
  }
  return undefined;
}

/**
 * Given an asset ID, list the accounts that hold it at a round, in address
 * order, with their balance and frozen flag. Accounts opted in with a zero
 * balance are listed. Requires a time-travel algod with its asset holders
 * index (`TimeTravelHoldersIndex`).
 *
 * Pages hold at most `limit` holders (default 1,000, at most 10,000), and
 * stop after examining 100,000 accounts that ever held the asset, so a page
 * can be short, or even empty, while more holders remain: only a missing
 * `nextToken` means there are no more. Every page must be read at the same
 * round: `pages()` and `iterate()` pin the first page's `round` when no
 * `round()` was set; a manual `next()` loop must pass `round(first.round)`
 * itself.
 *
 * A node with time travel or the holders index off is thrown as a
 * {@link DTUnsupportedError}; `supportsAssetHolders()` finds out without
 * listing anything. A page read at a round (with `round()`, or pinned by
 * `pages()`) must be marked with it (`X-Algod-TT-Round`), a 404 included;
 * otherwise it is thrown as a {@link DTUnsupportedError} too. An asset that does not exist (also at a round
 * before its creation) is the node's 404, and an index still being built its
 * 503, both thrown as the HTTP error (`isHistoryUnavailable` recognizes the
 * 503).
 *
 * #### Example
 * ```typescript
 * for await (const holder of algodClient
 *   .getAssetHolders(31566704)
 *   .round(50_000_000)
 *   .iterate()) {
 *   console.log(holder.address, holder.amount, holder.isFrozen);
 * }
 * ```
 *
 * @category GET
 */
export default class GetAssetHolders extends JSONRequest<AssetHoldersResponse> {
  private assetID: bigint;

  private requestedRound?: bigint;

  constructor(c: HTTPClient, assetID: number | bigint) {
    super(c);
    this.assetID = BigInt(assetID);
  }

  /**
   * @returns `/v2/assets/${assetID}/holders`
   */
  path() {
    return `/v2/assets/${this.assetID}/holders`;
  }

  /**
   * List the holders at this round. Defaults to the latest round.
   *
   * @param round - The round.
   * @category query
   */
  round(round: number | bigint) {
    this.requestedRound = ensureBigInt(round);
    this.query.round = this.requestedRound.toString();
    return this;
  }

  /**
   * Holders per page: default 1,000, from 1 to 10,000.
   *
   * @param limit - Maximum number of holders per page.
   * @category query
   */
  limit(limit: number) {
    this.query.limit = limit.toString();
    return this;
  }

  /**
   * The `nextToken` of the previous page (an address, after which the page
   * starts). Pass the previous page's `round` with it.
   *
   * @param nextToken - The previous page's `nextToken`.
   * @category query
   */
  next(nextToken: string | undefined) {
    this.query.next = nextToken;
    return this;
  }

  protected executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    return this.getPage(this.query, headers, customOptions);
  }

  prepare(response: HTTPClientResponse): AssetHoldersResponse {
    return this.decode(response);
  }

  /**
   * Fetch every page, until a page has no `nextToken`, empty pages included.
   * Without `round()`, the first page's `round` is sent with every later page,
   * so they all list the same round. The builder's own query is not modified.
   *
   * @param headers - Additional headers to send in each request. Optional.
   * @param customOptions - Additional options to pass to the underlying BaseHTTPClient. Optional.
   */
  async *pages(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): AsyncGenerator<AssetHoldersResponse, void, undefined> {
    let pinned = this.requestedRound;
    yield* pageThrough(
      this.query,
      async (query) => {
        if (pinned !== undefined) {
          // eslint-disable-next-line no-param-reassign
          query.round = pinned.toString();
        }
        const page = this.decode(
          await this.getPage(query, headers, customOptions)
        );
        pinned = page.round;
        return page;
      },
      this.path()
    );
  }

  /**
   * Iterate over every holder at the round, fetching pages as needed (see
   * `pages()`).
   *
   * @param headers - Additional headers to send in each request. Optional.
   * @param customOptions - Additional options to pass to the underlying BaseHTTPClient. Optional.
   */
  async *iterate(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): AsyncGenerator<AssetHolder, void, undefined> {
    for await (const page of this.pages(headers, customOptions)) {
      yield* page.holders;
    }
  }

  // eslint-disable-next-line class-methods-use-this
  private decode(response: HTTPClientResponse): AssetHoldersResponse {
    return decodeDTJSON(response.getJSONText(), AssetHoldersResponse);
  }

  private async getPage(
    query: Query<any>,
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    const round =
      query.round === undefined ? undefined : BigInt(String(query.round));
    const request = this.c
      .get({
        relativePath: this.path(),
        query,
        requestHeaders: headers,
        customOptions,
      })
      .catch((err) => {
        const reason = holdersUnsupportedReason(err);
        if (reason !== undefined) {
          throw new DTUnsupportedError(
            `The node cannot list asset holders: ${reason}`,
            { requestedRound: round, cause: err }
          );
        }
        throw err;
      });
    return readAtRound(round, request);
  }
}
