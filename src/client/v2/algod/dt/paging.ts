/**
 * Fetches the pages of a paged endpoint, sending each page's `nextToken` as
 * the `next` parameter of the following request, until a page has none.
 * Pages may be short, or even empty, and still have a `nextToken`: only its
 * absence ends the paging. The query passed in is not modified, and each
 * request gets its own copy of it.
 *
 * A node that answers with a token it was already sent would never end, so
 * that throws an `Error` instead.
 *
 * @param query - The query of the first page.
 * @param fetchPage - Fetches and decodes the page for a query.
 * @param what - What is paged, for the error message.
 */
export async function* pageThrough<Page extends { nextToken?: string }>(
  query: Record<string, any>,
  fetchPage: (query: Record<string, any>) => Promise<Page>,
  what: string
): AsyncGenerator<Page, void, undefined> {
  const q = { ...query };
  const sent = new Set<string>();
  for (;;) {
    if (q.next) sent.add(String(q.next));
    // HTTPClient drops empty values from the query object it is given, so
    // each page gets its own copy. Each page needs the previous page's token.
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchPage({ ...q });
    if (page.nextToken && sent.has(page.nextToken)) {
      throw new Error(
        `${what}: the node answered with a next-token it was already sent (${page.nextToken}), so paging would never end`
      );
    }
    yield page;
    if (!page.nextToken) return;
    q.next = page.nextToken;
  }
}
