import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { encodeMsgpack, decodeMsgpack } from '../../../../encoding/encoding.js';
import SimulateRawTransactions, {
  setSimulateTransactionsHeaders,
} from '../simulateTransaction.js';
import { SimulateRequest } from '../models/types.js';
import { DTSimulateRequest, DTSimulateResponse } from './models.js';
import { ensureUint64 } from '../../../../utils/utils.js';
import {
  SimulateFeatures,
  simulateWithFeatures,
  DTUnsupportedError,
} from './errors.js';

/**
 * {@link SimulateRawTransactions} with the fork's simulate features: several
 * transaction groups per request, `parallelGroups`, `rounds`, the validity
 * window modes and `protocol`. Requires a
 * node built from the time-travel fork; a stock node's rejection of these
 * features is thrown as a {@link DTUnsupportedError}.
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

  /** What the request uses beyond what stock algod simulates. */
  private features(): SimulateFeatures {
    const fields: string[] = [];
    // false is left out of the encoding, like an unset field.
    if (this.request.parallelGroups) {
      fields.push('parallel-groups');
    }
    if (this.requestedRounds()) fields.push('rounds');
    if (this.request.skipValidityWindow) fields.push('skip-validity-window');
    if (this.request.rewriteValidityWindow) {
      fields.push('rewrite-validity-window');
    }
    if (this.request.protocol) fields.push('protocol');
    return { groups: this.request.txnGroups.length, fields };
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

  /**
   * Throws a {@link DTUnsupportedError} if the request set a fork option the
   * response does not show was applied: a validity window mode missing from
   * `evalOverrides`, or `protocol` without a `protocolOverride` (at the top
   * level, or in each round result without an `error`).
   */
  private checkOptionsApplied(data: DTSimulateResponse) {
    const { skipValidityWindow, rewriteValidityWindow, protocol } =
      this.request;
    const overrides = data.evalOverrides;
    const modes: [boolean | undefined, boolean | undefined, string][] = [
      [
        skipValidityWindow,
        overrides?.skipValidityWindow,
        'skip-validity-window',
      ],
      [
        rewriteValidityWindow,
        overrides?.rewriteValidityWindow,
        'rewrite-validity-window',
      ],
    ];
    for (const [asked, echoed, name] of modes) {
      if (asked && !echoed) {
        throw new DTUnsupportedError(
          `Asked for ${name} but the node's eval-overrides do not show it; it does not support it`
        );
      }
    }
    if (!protocol) return;
    const missing = (where: string) =>
      new DTUnsupportedError(
        `Asked for protocol ${protocol} but the node answered without a protocol-override${where}; it does not support simulating under another protocol`
      );
    if (!this.requestedRounds()) {
      if (data.protocolOverride === undefined) throw missing('');
      return;
    }
    data.roundResults!.forEach((result, i) => {
      if (result.error === undefined && result.protocolOverride === undefined) {
        throw missing(` in round result ${i}`);
      }
    });
  }

  /**
   * Throws a {@link DTUnsupportedError} if the request listed rounds
   * and the response does not have one result per entry, each for the round
   * asked for (any round for a 0 entry, which the node resolves).
   */
  private checkRoundResults(data: DTSimulateResponse) {
    const rounds = this.requestedRounds();
    if (!rounds) return;
    const results = data.roundResults;
    if (results === undefined || results.length !== rounds.length) {
      throw new DTUnsupportedError(
        `Asked to simulate at ${rounds.length} rounds but the node answered with ${results === undefined ? 'no round-results' : `${results.length} round results`}; it does not support simulating at several rounds`
      );
    }
    rounds.forEach((requested, i) => {
      const returned = results[i].lastRound;
      if (requested !== BigInt(0) && returned !== requested) {
        throw new DTUnsupportedError(
          `Round result ${i} is for round ${returned}, not the round asked for, ${requested}`,
          { requestedRound: requested, returnedRound: returned }
        );
      }
    });
  }

  /**
   * Throws a {@link DTUnsupportedError} if the response does not have
   * one group result per requested group: at the top level, or in each round
   * result without an `error`. The node returns one per group, including
   * groups it did not simulate, so results can be matched to groups by index.
   */
  private checkGroupResults(data: DTSimulateResponse) {
    const expected = this.request.txnGroups.length;
    const check = (actual: number, where: string) => {
      if (actual !== expected) {
        throw new DTUnsupportedError(
          `Simulated ${expected} transaction groups but the node answered with ${actual} group results${where}`
        );
      }
    };
    if (!this.requestedRounds()) {
      check(data.txnGroups.length, '');
      return;
    }
    data.roundResults!.forEach((result, i) => {
      if (result.error === undefined) {
        check(result.txnGroups.length, ` in round result ${i}`);
      }
    });
  }

  protected executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    const invalid = this.invalidReason();
    if (invalid !== undefined) return Promise.reject(new Error(invalid));
    // Encoded here, not in the constructor, so that the builders apply.
    return simulateWithFeatures(
      this.features(),
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
    this.checkRoundResults(data);
    this.checkGroupResults(data);
    this.checkOptionsApplied(data);
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

  /**
   * Execute the request, returning the response body as received. With
   * `rounds` or `protocol`, the response is also decoded to check that the
   * node applied them.
   * @param headers - Additional headers to send in the request. Optional.
   * @param customOptions - Additional options to pass to the underlying BaseHTTPClient. Optional.
   */
  async doRaw(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<Uint8Array> {
    const res = await this.executeRequest(headers, customOptions);
    // The validity window modes require rounds.
    if (this.requestedRounds() || this.request.protocol) this.prepare(res);
    return res.body;
  }
}
