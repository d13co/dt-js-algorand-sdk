import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { encodeMsgpack, decodeMsgpack } from '../../../../encoding/encoding.js';
import SimulateRawTransactions, {
  setSimulateTransactionsHeaders,
} from '../simulateTransaction.js';
import { SimulateRequest } from '../models/types.js';
import { DTSimulateRequest, DTSimulateResponse } from './models.js';
import { ensureUint64 } from '../../../../utils/utils.js';
import { simulateWithRounds } from './errors.js';

/**
 * {@link SimulateRawTransactions} with the fork's simulate features: several
 * transaction groups per request, `parallelGroups`, `rounds`, the validity
 * window modes and `protocol`. Requires a dtalgod node. A node with `rounds`
 * disabled (`MaxAPISimulateRounds` 0, `simulate.maxRounds` 0 in `capabilities()`)
 * is thrown as a {@link DTUnsupportedError}.
 *
 * The request is copied when this is made (its group list too, not the groups
 * themselves) and encoded when it is sent, so the builders apply.
 */
export default class SimulateTransactionsAt extends SimulateRawTransactions {
  private request: DTSimulateRequest;

  constructor(c: HTTPClient, request: SimulateRequest) {
    // The base class encodes the request it is given; this class encodes its
    // own copy when it is sent, so give the base an empty one.
    super(c, new SimulateRequest({ txnGroups: [] }));
    this.request = DTSimulateRequest.from(request);
  }

  /**
   * Simulate every transaction group alone against the state at the start
   * round, concurrently, instead of as consecutive groups of one block. Groups
   * then do not see each other's effects, duplicate transactions and leases
   * are not detected across groups, and several groups may create the same
   * app or asset ID.
   *
   * @param parallelGroups - Whether to simulate the groups independently.
   * @category body
   */
  parallelGroups(parallelGroups = true) {
    this.request.parallelGroups = parallelGroups;
    return this;
  }

  /**
   * Simulate the request once per listed round instead of once. Each entry
   * means what `round` means: the round preceding the simulation, with 0 for
   * the latest round. The results are in the response's `roundResults`, one
   * per entry in this order; a round that cannot be simulated (not available,
   * or a group invalid under that round's protocol) has an `error` there
   * instead of failing the request. The top-level `lastRound` is then 0 and
   * `txnGroups` is empty.
   *
   * Cannot be combined with a non-zero `round`. A round listed several times
   * is simulated once. The node's `MaxAPISimulateRounds` (default 16) limits
   * how many entries a request may list, duplicates included. An empty list
   * sends no rounds, clearing any the request had.
   *
   * @param rounds - The rounds to simulate at.
   * @category body
   */
  rounds(rounds: (number | bigint)[]) {
    this.request.rounds = rounds.map(ensureUint64);
    return this;
  }

  /**
   * Evaluate the transactions as sent at every round, even outside their
   * `firstValid`..`lastValid` window, so `rounds` can be more than
   * `MaxTxnLife` (1000) apart. The round-range check and the check for a
   * transaction ID confirmed earlier are skipped; leases, duplicates in the
   * block, the genesis ID and hash, well-formedness and fees are still
   * checked. Programs see the original window, so `block`, the
   * `FirstValidTime` field and inner transactions stay tied to it, and reading a
   * block after the start round fails.
   *
   * Only with `rounds`, and not with `rewriteValidityWindow`.
   *
   * @param skipValidityWindow - Whether to skip the validity window check.
   * @category body
   */
  skipValidityWindow(skipValidityWindow = true) {
    this.request.skipValidityWindow = skipValidityWindow;
    return this;
  }

  /**
   * At every round, move each top-level transaction's validity window to the
   * simulated block, keeping its width, and recompute valid group IDs, so
   * `rounds` can be more than `MaxTxnLife` (1000) apart. Transaction IDs
   * change, so the signatures over every changed transaction (sig, msig, PQ
   * signature bytes) are dropped; logic signatures are kept.
   *
   * The results echo the rewritten transactions: do not match them by
   * transaction ID. Transactions that differ only by their window become
   * identical, so the later one fails as a duplicate: give them distinct
   * notes.
   *
   * Only with `rounds` and `allowEmptySignatures`, and not with
   * `skipValidityWindow`.
   *
   * @param rewriteValidityWindow - Whether to move the validity windows.
   * @category body
   */
  rewriteValidityWindow(rewriteValidityWindow = true) {
    this.request.rewriteValidityWindow = rewriteValidityWindow;
    return this;
  }

  /**
   * Simulate the round under a later consensus protocol, as if an upgrade to
   * it took effect right after the start round: its programs, limits, fees
   * and other parameters apply, to programs deployed earlier too. With
   * `rounds`, it applies to every round.
   *
   * The response's `protocolOverride` (each round result's, with `rounds`)
   * has the protocol the round really ran (`from`), the resolved target
   * (`to`), whether it `applied` (not when they are the same), and `notes`
   * on where the simulation differs from what the chain recorded: changed
   * parameters as a whole, and data the chain never produced, which reads
   * as a real upgrade would have seen it (usually zero), with the
   * transactions that read it.
   *
   * An unknown name, or `future` without the developer API, is a 400 for the
   * whole request. A protocol that is not a later one of the chain than the
   * round really ran is a 400, or that round's `error` with `rounds`. The
   * protocol the round really ran is simulated as it is, with `applied`
   * false.
   *
   * @param protocol - A consensus version string, `v24` to `v43` for a
   * mainline one, `latest` (the protocol of the block after the node's latest
   * one) or `future` (vFuture, only on a node with `EnableDeveloperAPI`). An
   * empty string sends none.
   * @category body
   */
  protocol(protocol: string) {
    this.request.protocol = protocol === '' ? undefined : protocol;
    return this;
  }

  /** The rounds asked for, if any; an empty list sends none. */
  private requestedRounds(): bigint[] | undefined {
    const { rounds } = this.request;
    return rounds !== undefined && rounds.length > 0 ? rounds : undefined;
  }

  /**
   * Why the request is invalid in a way the node would reject as a whole, or
   * undefined. Checked before sending, for a clearer error than the node's.
   */
  private invalidReason(): string | undefined {
    const { round, skipValidityWindow, rewriteValidityWindow } = this.request;
    const rounds = this.requestedRounds();
    if (rounds && round !== undefined && round !== BigInt(0)) {
      return `Cannot simulate at round ${round} and at rounds: set one or the other`;
    }
    if (skipValidityWindow && rewriteValidityWindow) {
      return 'Cannot both skip and rewrite the validity window: set one or the other';
    }
    if ((skipValidityWindow || rewriteValidityWindow) && !rounds) {
      return `${skipValidityWindow ? 'skipValidityWindow' : 'rewriteValidityWindow'} requires rounds`;
    }
    if (rewriteValidityWindow && !this.request.allowEmptySignatures) {
      return 'rewriteValidityWindow requires allowEmptySignatures, since it drops the signatures of the transactions it changes';
    }
    return undefined;
  }

  protected executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    const invalid = this.invalidReason();
    if (invalid !== undefined) return Promise.reject(new Error(invalid));
    // Encoded here, not in the constructor, so that the builders apply.
    return simulateWithRounds(
      this.c.post({
        relativePath: this.path(),
        data: encodeMsgpack(this.request),
        query: this.query,
        requestHeaders: setSimulateTransactionsHeaders(headers),
        customOptions,
      })
    );
  }

  prepare(response: HTTPClientResponse): DTSimulateResponse {
    const data = decodeMsgpack(response.body, DTSimulateResponse);
    data.requestGroupCount = this.request.txnGroups.length;
    return data;
  }

  /**
   * Execute the request.
   * @param headers - Additional headers to send in the request. Optional.
   * @param customOptions - Additional options to pass to the underlying BaseHTTPClient. Optional.
   */
  async do(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<DTSimulateResponse> {
    return (await super.do(headers, customOptions)) as DTSimulateResponse;
  }

  /**
   * Execute the request, as `do()` does, and also return the response headers,
   * keyed by lowercased name.
   * @param headers - Additional headers to send in the request. Optional.
   * @param customOptions - Additional options to pass to the underlying BaseHTTPClient. Optional.
   */
  async doWithHeaders(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<{ data: DTSimulateResponse; headers: Record<string, string> }> {
    const res = await super.doWithHeaders(headers, customOptions);
    return { data: res.data as DTSimulateResponse, headers: res.headers };
  }
}
