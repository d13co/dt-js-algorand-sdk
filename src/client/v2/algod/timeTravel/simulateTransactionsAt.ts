import { HTTPClient, HTTPClientResponse } from '../../../client.js';
import { encodeMsgpack, decodeMsgpack } from '../../../../encoding/encoding.js';
import SimulateRawTransactions, {
  setSimulateTransactionsHeaders,
} from '../simulateTransaction.js';
import { SimulateRequest } from '../models/types.js';
import {
  TimeTravelSimulateRequest,
  TimeTravelSimulateResponse,
} from './models.js';
import { ensureUint64 } from '../../../../utils/utils.js';
import {
  SimulateFeatures,
  simulateWithFeatures,
  TimeTravelUnsupportedError,
} from './errors.js';

/**
 * {@link SimulateRawTransactions} with the fork's simulate features: several
 * transaction groups per request, `parallelGroups` and `rounds`. Requires a
 * node built from the time-travel fork; a stock node's rejection of these
 * features is thrown as a {@link TimeTravelUnsupportedError}.
 *
 * The request is copied when this is made (its group list too, not the groups
 * themselves) and encoded when it is sent, so the builders apply.
 */
export default class SimulateTransactionsAt extends SimulateRawTransactions {
  private request: TimeTravelSimulateRequest;

  constructor(c: HTTPClient, request: SimulateRequest) {
    // The base class encodes the request it is given; this class encodes its
    // own copy when it is sent, so give the base an empty one.
    super(c, new SimulateRequest({ txnGroups: [] }));
    this.request = TimeTravelSimulateRequest.from(request);
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
    return { groups: this.request.txnGroups.length, fields };
  }

  /**
   * Throws a {@link TimeTravelUnsupportedError} if the request listed rounds
   * and the response does not have one result per entry, each for the round
   * asked for (any round for a 0 entry, which the node resolves).
   */
  private checkRoundResults(data: TimeTravelSimulateResponse) {
    const rounds = this.requestedRounds();
    if (!rounds) return;
    const results = data.roundResults;
    if (results === undefined || results.length !== rounds.length) {
      throw new TimeTravelUnsupportedError(
        `Asked to simulate at ${rounds.length} rounds but the node answered with ${results === undefined ? 'no round-results' : `${results.length} round results`}; it does not support simulating at several rounds`
      );
    }
    rounds.forEach((requested, i) => {
      const returned = results[i].lastRound;
      if (requested !== BigInt(0) && returned !== requested) {
        throw new TimeTravelUnsupportedError(
          `Round result ${i} is for round ${returned}, not the round asked for, ${requested}`,
          { requestedRound: requested, returnedRound: returned }
        );
      }
    });
  }

  protected executeRequest(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<HTTPClientResponse> {
    const { round } = this.request;
    if (this.requestedRounds() && round !== undefined && round !== BigInt(0)) {
      return Promise.reject(
        new Error(
          `Cannot simulate at round ${round} and at rounds: set one or the other`
        )
      );
    }
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

  prepare(response: HTTPClientResponse): TimeTravelSimulateResponse {
    const data = decodeMsgpack(response.body, TimeTravelSimulateResponse);
    this.checkRoundResults(data);
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
  ): Promise<TimeTravelSimulateResponse> {
    return (await super.do(
      headers,
      customOptions
    )) as TimeTravelSimulateResponse;
  }

  /**
   * Execute the request, returning the response body as received. With
   * `rounds`, the response is also decoded to check its round results.
   * @param headers - Additional headers to send in the request. Optional.
   * @param customOptions - Additional options to pass to the underlying BaseHTTPClient. Optional.
   */
  async doRaw(
    headers?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<Uint8Array> {
    const res = await this.executeRequest(headers, customOptions);
    if (this.requestedRounds()) this.prepare(res);
    return res.body;
  }
}
