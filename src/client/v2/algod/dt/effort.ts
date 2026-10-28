/**
 * The response header in which a dt-algorand node with `EnableEffortHeader`
 * reports the work a request did, lowercased as response headers are keyed.
 * It is off by default, and meant for a load balancer that bills on it and
 * removes it, so most clients never see it. Browsers cannot read it on a
 * cross-origin request until the node exposes it
 * (`Access-Control-Expose-Headers`).
 */
export const EFFORT_HEADER = 'x-algod-effort';

/** The work a request did, from the {@link EFFORT_HEADER} header. */
export interface Effort {
  /** Opcodes evaluated (simulate, query). */
  opcodes: number;
  /** Ledger lookups. */
  lookups: number;
  /** Lookups that read time-travel history. */
  history: number;
  /** Records scanned (versions, holders). */
  scanned: number;
  /** Bytes of the response body. */
  responseBytes: number;
  /** Time spent serving the request, in microseconds. */
  evalMicroseconds: number;
}

const EFFORT_KEYS: Record<string, keyof Effort> = {
  opcodes: 'opcodes',
  lookups: 'lookups',
  history: 'history',
  scanned: 'scanned',
  'response-bytes': 'responseBytes',
  'eval-us': 'evalMicroseconds',
};

/**
 * Parses the {@link EFFORT_HEADER} header, an RFC 9651 dictionary of
 * integers such as
 * `opcodes=700, lookups=3, history=2, scanned=0, response-bytes=512, eval-us=840`.
 * Unknown keys are ignored. Returns undefined when the header is absent, or
 * when a known key is missing or not an integer.
 *
 * @param value - The header's value.
 */
export function parseEffortHeader(
  value: string | undefined
): Effort | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const found: Partial<Effort> = {};
  for (const member of value.split(',')) {
    // Parameters (`;name=value`) are not used by the node: drop them.
    const [item] = member.split(';');
    const eq = item.indexOf('=');
    const name = (eq < 0 ? item : item.slice(0, eq)).trim();
    const field = EFFORT_KEYS[name];
    if (field !== undefined) {
      const raw = eq < 0 ? '' : item.slice(eq + 1).trim();
      if (!/^-?\d{1,15}$/.test(raw)) return undefined;
      found[field] = Number(raw);
    }
  }
  const fields = Object.values(EFFORT_KEYS);
  if (fields.some((f) => found[f] === undefined)) return undefined;
  return found as Effort;
}

/**
 * The effort a response reports, from its headers (as `doWithHeaders()` or
 * an HTTP error's `response.headers` give them), or undefined.
 *
 * #### Example
 * ```typescript
 * const { data, headers } = await algodClient.query(request).doWithHeaders();
 * console.log(algosdk.effortOf(headers)?.opcodes);
 * ```
 *
 * @param headers - The response headers.
 */
export function effortOf(
  headers: Record<string, string> | undefined
): Effort | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === EFFORT_HEADER
  );
  return key === undefined ? undefined : parseEffortHeader(headers[key]);
}
