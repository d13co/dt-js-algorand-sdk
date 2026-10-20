import { ensureUint64 } from '../../../../utils/utils.js';

/**
 * The default for a node's `MaxAPISimulateGroups`: how many transaction groups
 * one simulate request may hold.
 */
export const DEFAULT_MAX_SIMULATE_GROUPS = 16;

/**
 * The default for a node's `MaxAPISimulateRounds`: how many entries a simulate
 * request's `rounds` may list, duplicates included.
 */
export const DEFAULT_MAX_SIMULATE_ROUNDS = 16;

/**
 * The consensus `MaxTxnLife`: a transaction's `lastValid - firstValid` may not
 * be more than this.
 */
export const MAX_TXN_LIFE = 1000;

/** One simulate request's worth of rounds, from {@link packSimulateRounds}. */
export interface SimulateRoundsWindow {
  /** The rounds to pass to `rounds()`, distinct and in ascending order. */
  rounds: bigint[];
  /** The `firstValid` for the request's transactions: the first round + 1. */
  firstValid: bigint;
  /**
   * The `lastValid` for the request's transactions: the last round + 1, or,
   * with `maxSpan: null`, at most `firstValid + MaxTxnLife`, so the window is
   * valid. The later rounds then lie outside it: simulate them with a
   * validity window mode.
   */
  lastValid: bigint;
}

/** The result of {@link packSimulateRounds}. */
export interface PackedSimulateRounds {
  /** The windows, one simulate request each, in ascending round order. */
  windows: SimulateRoundsWindow[];
  /**
   * Where each input round went, in input order: its window, and its index in
   * that window's `rounds`, which is its round index in that request's
   * response. Repeated input rounds share one position.
   */
  positions: { window: number; roundIndex: number }[];
}

/**
 * Packs rounds to simulate at into as few requests as possible, given that
 * every round of a request must lie within its transactions' validity window.
 *
 * Simulating at round R evaluates the transactions as if in block R + 1, so
 * they must have `firstValid <= R + 1 <= lastValid`, and
 * `lastValid - firstValid` may not exceed `MaxTxnLife` (1000). A request's
 * rounds must therefore span at most `maxSpan`, and it may list at most
 * `maxRounds` of them. Build each window's transactions with its `firstValid`
 * and `lastValid`, simulate them with `rounds(window.rounds)`, and use
 * `positions` to find each input round's results.
 *
 * With `skipValidityWindow()` or `rewriteValidityWindow()`, the rounds of a
 * request need not lie in the transactions' window: pass `maxSpan: null` to
 * pack by `maxRounds` only.
 *
 * #### Example
 * ```typescript
 * const { windows, positions } = algosdk.packSimulateRounds(rounds);
 * const responses = await Promise.all(
 *   windows.map((w) =>
 *     algodClient
 *       .simulateTransactions(buildRequest(w.firstValid, w.lastValid))
 *       .rounds(w.rounds)
 *       .do()
 *   )
 * );
 * const results = positions.map(({ window, roundIndex }) =>
 *   responses[window].groupResults()[roundIndex]
 * );
 * ```
 *
 * @param rounds - The rounds, as `rounds()` takes them. 0 (the latest round)
 * is not allowed: look the round up first, with `status()`.
 * @param options - `maxRounds`: the most rounds per request, the node's
 * `MaxAPISimulateRounds` (default 16). `maxSpan`: the most rounds between the
 * first and the last of a request (default 1000, `MaxTxnLife`), or null for
 * no limit.
 * @throws RangeError for a round of 0 or an invalid option.
 */
export function packSimulateRounds(
  rounds: (number | bigint)[],
  {
    maxRounds = DEFAULT_MAX_SIMULATE_ROUNDS,
    maxSpan = MAX_TXN_LIFE,
  }: { maxRounds?: number; maxSpan?: number | bigint | null } = {}
): PackedSimulateRounds {
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new RangeError(
      `maxRounds must be a positive integer, not ${maxRounds}`
    );
  }
  const span = maxSpan === null ? undefined : ensureUint64(maxSpan);
  const requested = rounds.map((round) => {
    const r = ensureUint64(round);
    if (r === BigInt(0)) {
      throw new RangeError(
        'Cannot pack round 0 (the latest round): look the round up first'
      );
    }
    return r;
  });
  const distinct = [...new Set(requested)].sort((a, b) => {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  });

  const windows: SimulateRoundsWindow[] = [];
  const found = new Map<bigint, { window: number; roundIndex: number }>();
  for (const round of distinct) {
    let current = windows[windows.length - 1];
    if (
      current === undefined ||
      current.rounds.length >= maxRounds ||
      (span !== undefined && round - current.rounds[0] > span)
    ) {
      current = {
        rounds: [],
        firstValid: round + BigInt(1),
        lastValid: BigInt(0),
      };
      windows.push(current);
    }
    found.set(round, {
      window: windows.length - 1,
      roundIndex: current.rounds.length,
    });
    current.rounds.push(round);
    current.lastValid = round + BigInt(1);
    // Without a span limit the rounds may not fit a valid window.
    const widest = current.firstValid + BigInt(MAX_TXN_LIFE);
    if (current.lastValid > widest) current.lastValid = widest;
  }
  return { windows, positions: requested.map((r) => found.get(r)!) };
}
