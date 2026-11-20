import { Address } from '../../../../encoding/address.js';
import { base64ToBytes } from '../../../../encoding/binarydata.js';
import {
  DisassemblyLine,
  GroupStateChanges,
  ProgramBudget,
  ProgramDisassembly,
  TxnStateChanges,
  TxnStateChangesResponse,
} from './models.js';

/**
 * The group of a state changes answer that holds a top-level transaction, or
 * undefined if none does (the transaction is not in the round, or a
 * `txids()` filter left its group out). Needs `groups`: ask for them with
 * `include()` or `full()`, or this throws.
 *
 * @param response - A `getTxnStateChangesForRound` answer.
 * @param txid - The transaction ID.
 */
export function groupOf(
  response: TxnStateChangesResponse,
  txid: string
): GroupStateChanges | undefined {
  if (response.groups === undefined) {
    throw new Error(
      'The state changes have no groups: ask for them with include() or full()'
    );
  }
  return response.groups.find((g) => g.txids.includes(txid));
}

/**
 * A group's entries in the answer's `txns`, top-level and inner, in
 * execution order: the app state changes of its transactions, matched by
 * `path[0]` against the group's `first` and `count`. With an `app()` filter,
 * only that app's changes are in `txns`, so only those are here.
 *
 * @param response - A `getTxnStateChangesForRound` answer.
 * @param group - One of its `groups`.
 */
export function txnsOf(
  response: TxnStateChangesResponse,
  group: GroupStateChanges
): TxnStateChanges[] {
  const end = group.first + group.count;
  return response.txns.filter(
    (t) => t.path[0] >= group.first && t.path[0] < end
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    Object.getPrototypeOf(a) === Object.getPrototypeOf(b)
  ) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) =>
      sameValue(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k]
      )
    );
  }
  return false;
}

/**
 * The names of the fields that differ between a change's `before` and
 * `after`, such as `['amount', 'authAddr']` for an `AccountState`, compared
 * by value (bytes, addresses and nested models such as `appsTotalSchema`
 * included). With one side undefined (created or removed), the fields set on
 * the other. In the field order of the model.
 *
 * #### Example
 * ```typescript
 * for (const a of group.accounts) {
 *   for (const f of changedFields(a.before, a.after)) {
 *     console.log(a.address.toString(), f, a.before?.[f], a.after?.[f]);
 *   }
 * }
 * ```
 *
 * @param before - The value before (`AccountState`, `AssetParams`, ...).
 * @param after - The value after, of the same model.
 */
export function changedFields<T extends object>(
  before: T | undefined,
  after: T | undefined
): (keyof T & string)[] {
  const keys = new Set([
    ...Object.keys(after ?? {}),
    ...Object.keys(before ?? {}),
  ]);
  return [...keys].filter(
    (k) =>
      !sameValue(
        (before as Record<string, unknown> | undefined)?.[k],
        (after as Record<string, unknown> | undefined)?.[k]
      )
  ) as (keyof T & string)[];
}

/**
 * The group without the fee sink in its `accounts`, where it is whenever the
 * group paid fees. The answer's `feeSink` is the round's.
 *
 * @param group - One of the answer's `groups`.
 * @param feeSink - The fee sink, such as the answer's `feeSink`.
 */
export function withoutFeeSink(
  group: GroupStateChanges,
  feeSink: Address | string
): GroupStateChanges {
  const sink = feeSink.toString();
  return new GroupStateChanges({
    ...group,
    accounts: group.accounts.filter((a) => a.address.toString() !== sink),
  });
}

/** Each program's lines by pc, built on first use. */
const linesByPc = new WeakMap<
  ProgramDisassembly,
  Map<number, DisassemblyLine>
>();

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The line of a traced program that holds the opcode at `pc`, or undefined
 * if no program of the answer has that hash or no line of it that pc (as a
 * pc inside an opcode's immediates). The hash is a trace's
 * `approvalProgramHash`, `clearStateProgramHash` or `logicSigHash`, and the
 * pc a step's `pc`. Needs `programs`: ask for them with `trace()`, or this
 * throws.
 *
 * #### Example
 * ```typescript
 * const { execTrace } = res.traces![0];
 * for (const step of execTrace.approvalProgramTrace ?? []) {
 *   const line = programLine(res, execTrace.approvalProgramHash!, step.pc);
 *   console.log(step.pc, line?.text, step.stackAdditions);
 * }
 * ```
 *
 * @param response - A `getTxnStateChangesForRound` answer with `trace`.
 * @param hash - The program's hash (bytes, or base64).
 * @param pc - The program counter.
 */
export function programLine(
  response: TxnStateChangesResponse,
  hash: Uint8Array | string,
  pc: number | bigint
): DisassemblyLine | undefined {
  if (response.programs === undefined) {
    throw new Error(
      'The state changes have no programs: ask for them with trace()'
    );
  }
  const want = typeof hash === 'string' ? base64ToBytes(hash) : hash;
  const program = response.programs.find((p) => sameBytes(p.hash, want));
  if (program === undefined) return undefined;
  let byPc = linesByPc.get(program);
  if (byPc === undefined) {
    byPc = new Map();
    for (const line of program.lines) {
      if (line.pc !== undefined) byPc.set(line.pc, line);
    }
    linesByPc.set(program, byPc);
  }
  return byPc.get(Number(pc));
}

/**
 * The program runs of one transaction in the answer's `budget`, in the
 * order they began: its logic sig, then its app's approval or clear state
 * program, not those of its inner transactions, which have paths of their
 * own. A transaction is its `path` (as in `txns`: its payset index, then
 * its inner indexes) or, for a top-level one, its txid. Empty if it ran no
 * program, or the filters left it out. Needs `budget`: ask for it with
 * `include(['budget'])`, or this throws.
 *
 * @param response - A `getTxnStateChangesForRound` answer with `budget`.
 * @param txn - The transaction's path, or a top-level transaction's ID.
 */
export function budgetOf(
  response: TxnStateChangesResponse,
  txn: readonly (number | bigint)[] | string
): ProgramBudget[] {
  if (response.budget === undefined) {
    throw new Error(
      "The state changes have no budget: ask for it with include(['budget'])"
    );
  }
  if (typeof txn === 'string') {
    return response.budget.filter((b) => b.txid === txn);
  }
  const path = txn.map(Number);
  return response.budget.filter(
    (b) =>
      b.path.length === path.length && b.path.every((x, i) => x === path[i])
  );
}
