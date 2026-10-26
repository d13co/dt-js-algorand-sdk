/* eslint-env mocha */
import assert from 'assert';
import {
  encode as msgpackEncode,
  decode as msgpackDecode,
} from 'algorand-msgpack';
import {
  BaseHTTPClient,
  BaseHTTPClientResponse,
  Query,
} from '../src/client/baseHTTPClient';
import {
  DTAlgodClient,
  DTUnsupportedError,
  BoxVersion,
  BoxChange,
  BoxesVersion,
  SimulateRoundResult,
  DTSimulateRequest,
  DTSimulateResponse,
  DTSimulationEvalOverrides,
  SimulateGroupError,
  SimulateProtocolOverride,
  SimulateProtocolNote,
  SimulateProtocolNoteHit,
  SimulateLimitsResponse,
  QueryLimits,
  QueryRequest,
  QueryRequestParams,
  QueryCall,
  QueryResponse,
  QueryRoundResult,
  QueryCallResult,
  isQueryResponseTooLarge,
  packSimulateRounds,
} from '../src/client/v2/algod/dt/index';
import { AlgodClient } from '../src/client/v2/algod/algod';
import { assignGroupID, computeGroupID } from '../src/group';
import * as algosdk from '../src/index';
import {
  ApplicationInitialStates,
  PendingTransactionResponse,
  SimulateRequest,
  SimulateInitialStates,
  SimulateRequestTransactionGroup,
  SimulateResponse,
  SimulateTraceConfig,
  SimulateTransactionGroupResult,
  SimulateTransactionResult,
  SimulationEvalOverrides,
} from '../src/client/v2/algod/models/types';
import { NamedMapSchema } from '../src/encoding/schema/index';
import { decodeMsgpack, encodeMsgpack } from '../src/encoding/encoding';
import { SignedTransaction } from '../src/signedTransaction';
import { makePaymentTxnWithSuggestedParamsFromObject } from '../src/makeTxn';
import { AtomicTransactionComposer } from '../src/composer';
import { makeEmptyTransactionSigner } from '../src/signer';

type Call = { path: string; query: Query<string>; body?: Uint8Array };

/** A stub answer: a JSON body, or raw bytes such as msgpack. */
type Answer = { status: number; json?: unknown; body?: Uint8Array };

/**
 * A BaseHTTPClient that answers each request with the next queued handler.
 */
class StubClient implements BaseHTTPClient {
  calls: Call[] = [];

  private handlers: Array<(call: Call) => Answer>;

  constructor(handlers: Array<(call: Call) => Answer>) {
    this.handlers = handlers;
  }

  private async answer(call: Call): Promise<BaseHTTPClientResponse> {
    this.calls.push(call);
    const handler = this.handlers.shift();
    if (!handler) throw new Error(`unexpected request ${call.path}`);
    const { status, json, body } = handler(call);
    const response = {
      body: body ?? new TextEncoder().encode(JSON.stringify(json)),
      status,
      headers: {},
    };
    if (status >= 300) {
      // The message URLTokenBaseHTTPClient builds.
      const { message } = (json ?? {}) as { message?: string };
      throw Object.assign(
        new Error(
          `Network request error. Received status ${status} (Bad Request)${message ? `: ${message}` : ''}`
        ),
        { response }
      );
    }
    return response;
  }

  async get(
    path: string,
    query?: Query<string>
  ): Promise<BaseHTTPClientResponse> {
    return this.answer({ path, query: { ...(query ?? {}) } });
  }

  async post(
    path: string,
    data: Uint8Array,
    query?: Query<string>
  ): Promise<BaseHTTPClientResponse> {
    return this.answer({ path, query: { ...(query ?? {}) }, body: data });
  }

  // eslint-disable-next-line class-methods-use-this
  delete(): Promise<BaseHTTPClientResponse> {
    throw new Error('not implemented');
  }
}

const ok = (json: unknown) => () => ({ status: 200, json });
const status = (code: number) => () => ({
  status: code,
  json: { message: 'nope' },
});
const badRequest = (message: string) => () => ({
  status: 400,
  json: { message },
});

const name = new TextEncoder().encode('config');

describe('time travel', () => {
  describe('getApplicationBoxByName', () => {
    it('sends round and accepts a response for that round', async () => {
      const stub = new StubClient([
        ok({ round: 45000000, name: 'Y29uZmln', value: 'AAAAAAAAAAE=' }),
      ]);
      const box = await new DTAlgodClient(stub, '')
        .getApplicationBoxByName(1234, name)
        .round(45000000)
        .do();

      assert.strictEqual(stub.calls[0].path, '/v2/applications/1234/box');
      assert.deepStrictEqual(stub.calls[0].query, {
        name: 'b64:Y29uZmln',
        round: '45000000',
      });
      assert.strictEqual(box.round, BigInt(45000000));
      assert.deepStrictEqual(
        box.value,
        new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1])
      );
    });

    it('keeps round 0', async () => {
      const stub = new StubClient([ok({ round: 0, name: 'AA==', value: '' })]);
      await new DTAlgodClient(stub, '')
        .getApplicationBoxByName(1, new Uint8Array([0]))
        .round(0)
        .do();
      assert.strictEqual(stub.calls[0].query.round, '0');
    });

    it('throws when the node answers for another round', async () => {
      // Stock algod ignores round on /box and answers for the latest round.
      const stub = new StubClient([
        ok({ round: 50000000, name: 'Y29uZmln', value: 'AAAAAAAAAAI=' }),
      ]);
      await assert.rejects(
        new DTAlgodClient(stub, '')
          .getApplicationBoxByName(1234, name)
          .round(45000000)
          .do(),
        (err: unknown) =>
          err instanceof DTUnsupportedError &&
          err.requestedRound === BigInt(45000000) &&
          err.returnedRound === BigInt(50000000)
      );
    });

    it('does not check the round when none was asked for', async () => {
      const stub = new StubClient([
        ok({ round: 50000000, name: 'Y29uZmln', value: 'AAAAAAAAAAI=' }),
      ]);
      const box = await new DTAlgodClient(stub, '')
        .getApplicationBoxByName(1234, name)
        .do();
      assert.strictEqual(box.round, BigInt(50000000));
      assert.strictEqual(stub.calls[0].query.round, undefined);
    });
  });

  describe('getApplicationBoxes', () => {
    it('checks the round of the response', async () => {
      const stub = new StubClient([ok({ round: 7, boxes: [] })]);
      await assert.rejects(
        new DTAlgodClient(stub, '').getApplicationBoxes(1).round(6).do(),
        DTUnsupportedError
      );
    });

    it('accepts a response for the asked round', async () => {
      const stub = new StubClient([
        ok({ round: 6, boxes: [{ name: 'AA==' }], 'next-token': 'b64:AA==' }),
      ]);
      const res = await new DTAlgodClient(stub, '')
        .getApplicationBoxes(1)
        .round(6)
        .next('b64:AQ==')
        .do();
      assert.strictEqual(res.nextToken, 'b64:AA==');
      assert.strictEqual(stub.calls[0].query.round, '6');
      assert.strictEqual(stub.calls[0].query.next, 'b64:AQ==');
    });
  });

  describe('getApplicationBoxVersions', () => {
    it('serializes the query and decodes a page', async () => {
      const stub = new StubClient([
        ok({
          round: 45000000,
          versions: [
            {
              round: 44000120,
              timestamp: 1760000123,
              deleted: false,
              value: 'AAAAAAAAAAE=',
            },
            { round: 44000140, timestamp: 1760000201, deleted: true },
          ],
          'next-token': '44000152',
        }),
      ]);
      const res = await new DTAlgodClient(stub, '')
        .getApplicationBoxVersions(1234, name)
        .minRound(0)
        .maxRound(45000000)
        .order('desc')
        .limit(3)
        .include('values')
        .next('44000100')
        .do();

      assert.strictEqual(
        stub.calls[0].path,
        '/v2/applications/1234/box/versions'
      );
      assert.deepStrictEqual(stub.calls[0].query, {
        name: 'b64:Y29uZmln',
        'min-round': '0',
        'max-round': '45000000',
        order: 'desc',
        limit: '3',
        include: 'values',
        next: '44000100',
      });
      assert.strictEqual(res.round, BigInt(45000000));
      assert.strictEqual(res.nextToken, '44000152');
      assert.deepStrictEqual(res.versions, [
        new BoxVersion({
          round: 44000120,
          timestamp: 1760000123,
          deleted: false,
          value: 'AAAAAAAAAAE=',
        }),
        new BoxVersion({
          round: 44000140,
          timestamp: 1760000201,
          deleted: true,
        }),
      ]);
    });

    it('iterates across pages until there is no next-token', async () => {
      const v = (round: number) => ({
        round,
        timestamp: round,
        deleted: false,
      });
      const stub = new StubClient([
        ok({ round: 9, versions: [v(1), v(2)], 'next-token': '3' }),
        // A short page is not the end.
        ok({ round: 9, versions: [v(3)], 'next-token': '5' }),
        ok({ round: 9, versions: [v(5), v(8)] }),
      ]);
      const request = new DTAlgodClient(stub, '')
        .getApplicationBoxVersions(1, name)
        .limit(2);

      const rounds: bigint[] = [];
      for await (const version of request.iterate()) rounds.push(version.round);

      assert.deepStrictEqual(rounds, [1, 2, 3, 5, 8].map(BigInt));
      assert.deepStrictEqual(
        stub.calls.map((c) => c.query.next),
        [undefined, '3', '5']
      );
      assert.ok(stub.calls.every((c) => c.query.limit === '2'));
      // The builder itself is untouched.
      assert.strictEqual(request.query.next, undefined);
    });

    it('turns a 404 into DTUnsupportedError', async () => {
      const stub = new StubClient([status(404)]);
      await assert.rejects(
        new DTAlgodClient(stub, '').getApplicationBoxVersions(1, name).do(),
        DTUnsupportedError
      );
    });

    it('passes other errors through', async () => {
      const stub = new StubClient([status(400)]);
      await assert.rejects(
        new DTAlgodClient(stub, '').getApplicationBoxVersions(1, name).do(),
        (err: { status?: number }) =>
          !(err instanceof DTUnsupportedError) && err.status === 400
      );
    });
  });

  describe('getApplicationBoxesVersions', () => {
    it('serializes the query and decodes a page', async () => {
      // A descending page resumed from next=44000100 reports that round.
      const stub = new StubClient([
        ok({
          round: 44000100,
          versions: [
            {
              round: 44000090,
              timestamp: 1760000201,
              boxes: [
                { name: 'YQ==', deleted: false, value: 'AAAAAAAAAAE=' },
                { name: 'Yg==', deleted: true },
              ],
            },
            {
              round: 44000070,
              timestamp: 1760000123,
              // A zero-length box: its value is empty, not missing.
              boxes: [{ name: 'Yw==', deleted: false, value: '' }],
            },
          ],
          'next-token': '44000069',
        }),
      ]);
      const res = await new DTAlgodClient(stub, '')
        .getApplicationBoxesVersions(1234)
        .minRound(0)
        .maxRound(45000000)
        .order('desc')
        .limit(3)
        .include('values')
        .next('44000100')
        .do();

      assert.strictEqual(
        stub.calls[0].path,
        '/v2/applications/1234/boxes/versions'
      );
      assert.deepStrictEqual(stub.calls[0].query, {
        'min-round': '0',
        'max-round': '45000000',
        order: 'desc',
        limit: '3',
        include: 'values',
        next: '44000100',
      });
      assert.strictEqual(res.round, BigInt(44000100));
      assert.strictEqual(res.nextToken, '44000069');
      const bytes = (s: string) => new TextEncoder().encode(s);
      assert.deepStrictEqual(res.versions, [
        new BoxesVersion({
          round: 44000090,
          timestamp: 1760000201,
          boxes: [
            new BoxChange({
              name: bytes('a'),
              deleted: false,
              value: 'AAAAAAAAAAE=',
            }),
            new BoxChange({ name: bytes('b'), deleted: true }),
          ],
        }),
        new BoxesVersion({
          round: 44000070,
          timestamp: 1760000123,
          boxes: [
            new BoxChange({
              name: bytes('c'),
              deleted: false,
              value: new Uint8Array(0),
            }),
          ],
        }),
      ]);
      assert.strictEqual(res.versions[0].boxes[1].value, undefined);
    });

    it('leaves values out without include', async () => {
      const stub = new StubClient([
        ok({
          round: 9,
          versions: [
            {
              round: 2,
              timestamp: 20,
              boxes: [{ name: 'YQ==', deleted: false }],
            },
          ],
        }),
      ]);
      const res = await new DTAlgodClient(stub, '')
        .getApplicationBoxesVersions(1)
        .do();

      assert.strictEqual(stub.calls[0].query.include, undefined);
      assert.strictEqual(res.versions[0].boxes[0].value, undefined);
      assert.strictEqual(res.nextToken, undefined);
    });

    it('decodes an empty page', async () => {
      const stub = new StubClient([ok({ round: 9, versions: [] })]);
      const res = await new DTAlgodClient(stub, '')
        .getApplicationBoxesVersions(1)
        .do();

      assert.deepStrictEqual(res.versions, []);
      assert.strictEqual(res.round, BigInt(9));
      assert.strictEqual(res.nextToken, undefined);
    });

    it('iterates across pages until there is no next-token', async () => {
      const v = (round: number, box: string) => ({
        round,
        timestamp: round,
        boxes: [{ name: box, deleted: false, value: 'AQ==' }],
      });
      const stub = new StubClient([
        ok({
          round: 9,
          versions: [v(9, 'YQ=='), v(8, 'Yg==')],
          'next-token': '7',
        }),
        // A short page is not the end.
        ok({ round: 7, versions: [v(6, 'Yw==')], 'next-token': '5' }),
        ok({ round: 5, versions: [v(2, 'ZA==')] }),
      ]);
      const request = new DTAlgodClient(stub, '')
        .getApplicationBoxesVersions(1)
        .minRound(1)
        .maxRound(9)
        .order('desc')
        .limit(2)
        .include('values');

      const seen: Array<[bigint, string]> = [];
      for await (const version of request.iterate()) {
        for (const box of version.boxes) {
          assert.deepStrictEqual(box.value, new Uint8Array([1]));
          seen.push([version.round, new TextDecoder().decode(box.name)]);
        }
      }

      assert.deepStrictEqual(seen, [
        [BigInt(9), 'a'],
        [BigInt(8), 'b'],
        [BigInt(6), 'c'],
        [BigInt(2), 'd'],
      ]);
      assert.deepStrictEqual(
        stub.calls.map((c) => c.query),
        [undefined, '7', '5'].map((next) => ({
          'min-round': '1',
          'max-round': '9',
          order: 'desc',
          limit: '2',
          include: 'values',
          ...(next === undefined ? {} : { next }),
        }))
      );
      // The builder itself is untouched.
      assert.strictEqual(request.query.next, undefined);
    });

    it("recognizes stock algod's 400 should it route the path as an ID", async () => {
      const stub = new StubClient([
        badRequest(
          'Invalid format for parameter application-id: error binding string parameter: strconv.ParseUint: parsing "1/boxes/versions": invalid syntax'
        ),
      ]);
      await assert.rejects(
        new DTAlgodClient(stub, '').getApplicationBoxesVersions(1).do(),
        DTUnsupportedError
      );
    });

    it('passes a 400 for a bad next token through', async () => {
      // The same "parsing ...: invalid syntax" tail as stock algod's ID error.
      const stub = new StubClient([
        badRequest(
          'Unable to parse next token: strconv.ParseUint: parsing "x/versions": invalid syntax'
        ),
      ]);
      await assert.rejects(
        new DTAlgodClient(stub, '')
          .getApplicationBoxesVersions(1)
          .next('x/versions')
          .do(),
        (err: { status?: number }) =>
          !(err instanceof DTUnsupportedError) && err.status === 400
      );
    });

    it('turns a 404 into DTUnsupportedError', async () => {
      const stub = new StubClient([status(404)]);
      await assert.rejects(
        new DTAlgodClient(stub, '').getApplicationBoxesVersions(1).do(),
        DTUnsupportedError
      );
    });

    it('passes a 503 for an incomplete box index through', async () => {
      const stub = new StubClient([status(503)]);
      await assert.rejects(
        new DTAlgodClient(stub, '').getApplicationBoxesVersions(1).do(),
        (err: { status?: number }) =>
          !(err instanceof DTUnsupportedError) &&
          err.status === 503 &&
          /nope/.test(String((err as { message?: string }).message))
      );
    });
  });

  describe('supportsDT', () => {
    it('is true when the versions route answers, and is cached', async () => {
      const stub = new StubClient([ok({ round: 1, versions: [] })]);
      const client = new DTAlgodClient(stub, '');
      assert.strictEqual(await client.supportsDT(), true);
      assert.strictEqual(await client.supportsDT(), true);
      assert.strictEqual(stub.calls.length, 1);
    });

    it('is true when the route rejects the probe with 400', async () => {
      const stub = new StubClient([status(400)]);
      assert.strictEqual(await new DTAlgodClient(stub, '').supportsDT(), true);
    });

    it('is false when the route is missing', async () => {
      const stub = new StubClient([status(404)]);
      assert.strictEqual(await new DTAlgodClient(stub, '').supportsDT(), false);
    });

    it('rethrows other errors without caching them', async () => {
      const stub = new StubClient([
        status(401),
        ok({ round: 1, versions: [] }),
      ]);
      const client = new DTAlgodClient(stub, '');
      await assert.rejects(client.supportsDT());
      assert.strictEqual(await client.supportsDT(), true);
    });
  });

  describe('simulateLimits', () => {
    const limits = {
      'max-txn-groups': 8,
      'max-rounds': 4,
      'max-extra-opcode-budget': 640000,
      'resource-limit-multiplier': 2,
      'time-travel': true,
      'developer-api': false,
    };

    it('decodes the node limits and caches them', async () => {
      const stub = new StubClient([ok(limits)]);
      const client = new DTAlgodClient(stub, '');
      const got = await client.simulateLimits();
      assert.ok(got instanceof SimulateLimitsResponse);
      assert.deepStrictEqual(
        { ...got },
        {
          maxTxnGroups: 8,
          maxRounds: 4,
          maxExtraOpcodeBudget: 640000,
          resourceLimitMultiplier: 2,
          timeTravel: true,
          developerApi: false,
          maxExecTraceBytes: undefined,
          timeLimitSeconds: undefined,
          query: undefined,
          reported: true,
        }
      );
      assert.strictEqual(await client.simulateLimits(), got);
      assert.ok(Object.isFrozen(got));
      assert.strictEqual(stub.calls.length, 1);
      assert.strictEqual(
        stub.calls[0].path,
        '/v2/transactions/simulate/limits'
      );
    });

    it('decodes 0 rounds and false flags, which a node sends', async () => {
      const stub = new StubClient([
        ok({ ...limits, 'max-rounds': 0, 'time-travel': false }),
      ]);
      const got = await new DTAlgodClient(stub, '').simulateLimits();
      assert.strictEqual(got.maxRounds, 0);
      assert.strictEqual(got.timeTravel, false);
    });

    it('falls back to the stock limits on a 404, and caches them', async () => {
      const stub = new StubClient([status(404)]);
      const client = new DTAlgodClient(stub, '');
      const got = await client.simulateLimits();
      assert.deepStrictEqual(got, SimulateLimitsResponse.stock());
      assert.strictEqual(got.maxTxnGroups, 1);
      assert.strictEqual(got.maxRounds, 0);
      assert.strictEqual(got.maxExtraOpcodeBudget, 320000);
      assert.strictEqual(got.reported, false);
      assert.ok(Object.isFrozen(got));
      assert.strictEqual(await client.simulateLimits(), got);
      assert.strictEqual(stub.calls.length, 1);
    });

    it('throws a 404 as DTUnsupportedError from getSimulateLimits', async () => {
      const stub = new StubClient([status(404)]);
      await assert.rejects(
        new DTAlgodClient(stub, '').getSimulateLimits().do(),
        (err) =>
          err instanceof DTUnsupportedError &&
          (err.cause as { status?: number }).status === 404
      );
    });

    it('rethrows other errors without caching them', async () => {
      const stub = new StubClient([status(503), ok(limits)]);
      const client = new DTAlgodClient(stub, '');
      await assert.rejects(
        client.simulateLimits(),
        (err) =>
          !(err instanceof DTUnsupportedError) &&
          (err as { status?: number }).status === 503
      );
      assert.strictEqual((await client.simulateLimits()).maxTxnGroups, 8);
      assert.strictEqual(stub.calls.length, 2);
    });

    it('shares one request between concurrent calls', async () => {
      const stub = new StubClient([ok(limits)]);
      const client = new DTAlgodClient(stub, '');
      const [a, b] = await Promise.all([
        client.simulateLimits(),
        client.simulateLimits(),
      ]);
      assert.strictEqual(a, b);
      assert.strictEqual(stub.calls.length, 1);
    });

    it('is shared by DTAlgodClient.from for the same client', async () => {
      const stub = new StubClient([ok(limits)]);
      const algod = new AlgodClient(stub, '');
      await DTAlgodClient.from(algod).simulateLimits();
      await DTAlgodClient.from(algod).simulateLimits();
      assert.strictEqual(stub.calls.length, 1);
    });

    it('is listed in features', () => {
      assert.ok(DTAlgodClient.features.includes('simulate-limits'));
    });

    // What a node with POST /v2/query answers (127.0.0.1:8081, 2026-10-26).
    const withQuery = {
      ...limits,
      'max-exec-trace-bytes': 268435456,
      'time-limit-seconds': 119,
      query: {
        'max-call-budget': 320000,
        'max-call-log-bytes': 65536,
        'max-calls': 1024,
        'max-response-bytes': 67108864,
        'max-rounds': 16,
      },
    };

    it('decodes the query limits, frozen, and the newer fields', async () => {
      const stub = new StubClient([ok(withQuery)]);
      const got = await new DTAlgodClient(stub, '').simulateLimits();
      assert.ok(got.query instanceof QueryLimits);
      assert.deepStrictEqual(
        { ...got.query },
        {
          maxCalls: 1024,
          maxCallBudget: 320000,
          maxCallLogBytes: 65536,
          maxResponseBytes: 67108864,
          maxRounds: 16,
        }
      );
      assert.ok(Object.isFrozen(got.query));
      assert.strictEqual(got.maxExecTraceBytes, 268435456);
      assert.strictEqual(got.timeLimitSeconds, 119);
    });

    it('keeps 0 limits as 0, which means no limit', async () => {
      const stub = new StubClient([
        ok({
          ...withQuery,
          'max-exec-trace-bytes': 0,
          'time-limit-seconds': 0,
          query: {
            ...withQuery.query,
            'max-call-log-bytes': 0,
            'max-response-bytes': 0,
          },
        }),
      ]);
      const got = await new DTAlgodClient(stub, '').simulateLimits();
      assert.strictEqual(got.maxExecTraceBytes, 0);
      assert.strictEqual(got.timeLimitSeconds, 0);
      assert.strictEqual(got.query!.maxCallLogBytes, 0);
      assert.strictEqual(got.query!.maxResponseBytes, 0);
    });

    it('leaves query and the newer fields undefined when absent', async () => {
      const stub = new StubClient([ok(limits)]);
      const got = await new DTAlgodClient(stub, '').simulateLimits();
      assert.strictEqual(got.query, undefined);
      assert.strictEqual(got.maxExecTraceBytes, undefined);
      assert.strictEqual(got.timeLimitSeconds, undefined);
      const stock = SimulateLimitsResponse.stock();
      assert.strictEqual(stock.query, undefined);
      assert.strictEqual(stock.maxExecTraceBytes, undefined);
      assert.strictEqual(stock.timeLimitSeconds, undefined);
      assert.ok(
        !/query|max-exec-trace-bytes|time-limit-seconds/.test(
          algosdk.encodeJSON(stock)
        )
      );
    });

    it('encodes the query limits as the node does', () => {
      const decoded = algosdk.decodeJSON(
        JSON.stringify(withQuery),
        SimulateLimitsResponse
      );
      assert.deepStrictEqual(
        JSON.parse(algosdk.encodeJSON(decoded)),
        withQuery
      );
    });

    it('does not encode reported', () => {
      const encoded = algosdk.encodeJSON(SimulateLimitsResponse.stock());
      assert.ok(!/reported/.test(encoded));
      assert.strictEqual(
        algosdk.decodeJSON(encoded, SimulateLimitsResponse).reported,
        true
      );
    });
  });

  describe('query', () => {
    // #pragma version 10; global Round; itob; log; txn ApplicationArgs 0; log; int 1
    const PROGRAM = 'CjIGFrA2GgCwgQE=';
    const programBytes = algosdk.base64ToBytes(PROGRAM);
    const utf8 = (s: string) => new TextEncoder().encode(s);
    const ADDR = 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA';
    const ADDR2 = algosdk.Address.zeroAddress().toString();

    /** A msgpack answer built from a plain object with the node's keys. */
    const raw = (body: unknown) => () => ({
      status: 200,
      body: msgpackEncode(body),
    });

    /** The request body the stub received, decoded as plain msgpack. */
    const sentBody = (stub: StubClient, i = 0) =>
      msgpackDecode(stub.calls[i].body!) as Record<string, unknown>;

    const callResult = (
      round: number,
      extra: Record<string, unknown> = {}
    ) => ({
      cost: 6,
      logs: [utf8(`r${round}`)],
      ...extra,
    });

    const answer = (rounds: number[], calls = 1, lastRound = 100) =>
      raw({
        'last-round': lastRound,
        rounds: rounds.map((round) => ({
          round,
          calls: Array.from({ length: calls }, () => callResult(round)),
        })),
      });

    // Captured from a MainNet node (127.0.0.1:8081) with ?format=msgpack:
    // PROGRAM at rounds [50000000], protocol round, calls
    // [{args: ['hi']}, {args: ['']}, {}].
    const LIVE =
      'gqpsYXN0LXJvdW5kzgP0bwKmcm91bmRzkYKlY2FsbHOTgqRjb3N0BqRsb2dzksQIAAAAAAL68IHEAmhpgqRjb3N0BqRsb2dzksQIAAAAAAL68IHEAIOkY29zdASlZXJyb3LZe2xvZ2ljIGV2YWwgZXJyb3I6IGludmFsaWQgQXBwbGljYXRpb25BcmdzIGluZGV4IDAuIERldGFpbHM6IGFwcD0zMDAwMTEzMzc5LCBwYz01LCBvcGNvZGVzPWl0b2I7IGxvZzsgdHhuYSBBcHBsaWNhdGlvbkFyZ3MgMKRsb2dzkcQIAAAAAAL68IGlcm91bmTOAvrwgA==';

    it('sends POST /v2/query as msgpack with every field', async () => {
      const stub = new StubClient([answer([5])]);
      await new DTAlgodClient(stub, '')
        .query({
          program: programBytes,
          clearProgram: PROGRAM,
          globalSchema: { numUint: 1, numByteSlice: 2 },
          localSchema: new algosdk.modelsv2.ApplicationStateSchema({
            numUint: 3,
            numByteSlice: 4,
          }),
          sender: ADDR,
          rounds: [5],
          protocol: 'round',
          budget: 1000,
          calls: [
            {
              args: [utf8('hi'), new Uint8Array()],
              accounts: [ADDR, algosdk.Address.zeroAddress()],
              foreignApps: [7, 8n],
              foreignAssets: [31566704],
              boxes: [
                { app: 0, name: utf8('a') },
                new algosdk.modelsv2.BoxReference({ app: 9, name: utf8('b') }),
              ],
            },
          ],
        })
        .do();
      assert.strictEqual(stub.calls[0].path, '/v2/query');
      assert.strictEqual(stub.calls[0].query.format, 'msgpack');
      assert.deepStrictEqual(sentBody(stub), {
        program: programBytes,
        'clear-program': programBytes,
        'global-schema': { 'num-uint': 1, 'num-byte-slice': 2 },
        'local-schema': { 'num-uint': 3, 'num-byte-slice': 4 },
        sender: ADDR,
        rounds: [5],
        protocol: 'round',
        budget: 1000,
        calls: [
          {
            args: [utf8('hi'), new Uint8Array()],
            accounts: [ADDR, ADDR2],
            'foreign-apps': [7, 8],
            'foreign-assets': [31566704],
            boxes: [{ name: utf8('a') }, { app: 9, name: utf8('b') }],
          },
        ],
      });
    });

    it('sends app-id and only the keys that are set', async () => {
      const stub = new StubClient([answer([100], 2)]);
      await new DTAlgodClient(stub, '')
        .query({ appId: 760937186, calls: [{}, { args: [utf8('x')] }] })
        .do();
      assert.deepStrictEqual(sentBody(stub), {
        'app-id': 760937186,
        calls: [{}, { args: [utf8('x')] }],
      });
    });

    it('sets and clears rounds and protocol with the builders', async () => {
      const stub = new StubClient([answer([0, 5]), answer([100])]);
      const client = new DTAlgodClient(stub, '');
      await client
        .query({ program: PROGRAM, calls: [{}] })
        .rounds([0, 5n])
        .protocol('latest')
        .do();
      assert.deepStrictEqual(sentBody(stub).rounds, [0, 5]);
      assert.strictEqual(sentBody(stub).protocol, 'latest');
      await client
        .query({ program: PROGRAM, rounds: [5], protocol: 'v40', calls: [{}] })
        .rounds([])
        .protocol('')
        .do();
      assert.ok(!('rounds' in sentBody(stub, 1)));
      assert.ok(!('protocol' in sentBody(stub, 1)));
    });

    it('copies the request when it is made', async () => {
      const stub = new StubClient([answer([5])]);
      const request = new QueryRequest({
        program: PROGRAM,
        rounds: [5],
        calls: [{ args: [utf8('a')] }],
      });
      const call = new DTAlgodClient(stub, '').query(request).protocol('round');
      request.calls.push(new QueryCall({}));
      request.rounds!.push(6n);
      await call.do();
      assert.strictEqual(sentBody(stub).protocol, 'round');
      assert.deepStrictEqual(sentBody(stub).rounds, [5]);
      assert.strictEqual((sentBody(stub).calls as unknown[]).length, 1);
      assert.strictEqual(request.protocol, undefined);
    });

    it('rejects requests the node would refuse, without sending', async () => {
      const stub = new StubClient([]);
      const client = new DTAlgodClient(stub, '');
      const bad: [QueryRequestParams, RegExp][] = [
        [{ program: PROGRAM, calls: [] }, /at least one call/],
        [{ calls: [{}] }, /exactly one of program and appId/],
        [{ program: new Uint8Array(), appId: 0, calls: [{}] }, /exactly one/],
        [{ program: PROGRAM, appId: 5, calls: [{}] }, /exactly one/],
        [{ appId: 5, clearProgram: PROGRAM, calls: [{}] }, /need program/],
        [
          {
            appId: 5,
            globalSchema: { numUint: 0, numByteSlice: 0 },
            calls: [{}],
          },
          /need program/,
        ],
        [
          {
            appId: 5,
            localSchema: { numUint: 1, numByteSlice: 0 },
            calls: [{}],
          },
          /need program/,
        ],
      ];
      for (const [request, message] of bad) {
        // eslint-disable-next-line no-await-in-loop
        await assert.rejects(client.query(request).do(), message);
      }
      assert.strictEqual(stub.calls.length, 0);
    });

    it('decodes a response captured from a live node', async () => {
      const stub = new StubClient([
        () => ({ status: 200, body: algosdk.base64ToBytes(LIVE) }),
      ]);
      const res = await new DTAlgodClient(stub, '')
        .query({
          program: PROGRAM,
          rounds: [50000000],
          protocol: 'round',
          calls: [{ args: [utf8('hi')] }, { args: [new Uint8Array()] }, {}],
        })
        .do();
      assert.ok(res instanceof QueryResponse);
      assert.strictEqual(res.lastRound, 66350850n);
      assert.strictEqual(res.rounds.length, 1);
      const [r] = res.rounds;
      assert.ok(r instanceof QueryRoundResult);
      assert.strictEqual(r.round, 50000000n);
      assert.strictEqual(r.protocolOverride, undefined);
      assert.strictEqual(r.error, undefined);
      const roundLog = algosdk.encodeUint64(50000001);
      assert.deepStrictEqual(
        r.calls.map((c) => ({ ...c })),
        [
          { logs: [roundLog, utf8('hi')], cost: 6, error: undefined },
          { logs: [roundLog, new Uint8Array()], cost: 6, error: undefined },
          {
            logs: [roundLog],
            cost: 4,
            error:
              'logic eval error: invalid ApplicationArgs index 0. Details: app=3000113379, pc=5, opcodes=itob; log; txna ApplicationArgs 0',
          },
        ]
      );
      assert.ok(r.calls[0] instanceof QueryCallResult);
    });

    it('decodes round errors, protocol overrides, no logs and zero cost', async () => {
      const stub = new StubClient([
        raw({
          'last-round': 100,
          rounds: [
            {
              round: 100,
              calls: [
                { cost: 0, logs: [] },
                { logs: [utf8('x')], cost: 3, error: 'boom' },
              ],
            },
            {
              round: 7,
              protocol: {
                from: 'v20',
                to: 'v41',
                applied: true,
                notes: [{ code: 'semantics-changed', message: 'differ' }],
              },
              error:
                'program version 10 greater than protocol supported version 2',
            },
          ],
        }),
      ]);
      const res = await new DTAlgodClient(stub, '')
        .query({ program: PROGRAM, calls: [{}, {}] })
        .rounds([0, 7])
        .do();
      const [latest, past] = res.rounds;
      assert.strictEqual(latest.round, 100n);
      assert.deepStrictEqual(latest.calls[0].logs, []);
      assert.strictEqual(latest.calls[0].cost, 0);
      assert.strictEqual(latest.calls[0].error, undefined);
      assert.strictEqual(latest.calls[1].error, 'boom');
      assert.deepStrictEqual(latest.calls[1].logs, [utf8('x')]);
      assert.deepStrictEqual(past.calls, []);
      assert.match(past.error!, /program version 10/);
      assert.ok(past.protocolOverride instanceof SimulateProtocolOverride);
      assert.strictEqual(past.protocolOverride!.applied, true);
      assert.strictEqual(past.protocolOverride!.to, 'v41');
      assert.strictEqual(
        past.protocolOverride!.notes![0].code,
        'semantics-changed'
      );
    });

    it('checks the number of round results', async () => {
      const cases: [number[] | undefined, number[]][] = [
        [undefined, []],
        [undefined, [100, 100]],
        [[5, 6], [5]],
        [[5], [5, 6]],
      ];
      for (const [rounds, answered] of cases) {
        const stub = new StubClient([answer(answered)]);
        // eslint-disable-next-line no-await-in-loop
        await assert.rejects(
          new DTAlgodClient(stub, '')
            .query({ program: PROGRAM, rounds, calls: [{}] })
            .do(),
          (err) =>
            !(err instanceof DTUnsupportedError) &&
            /round results/.test((err as Error).message)
        );
      }
      // None requested: one result, for the latest round.
      const stub = new StubClient([answer([100])]);
      const res = await new DTAlgodClient(stub, '')
        .query({ program: PROGRAM, calls: [{}] })
        .do();
      assert.strictEqual(res.rounds[0].round, 100n);
    });

    it('checks each requested round, and accepts any round for 0', async () => {
      const stub = new StubClient([answer([5, 9])]);
      await assert.rejects(
        new DTAlgodClient(stub, '')
          .query({ program: PROGRAM, calls: [{}] })
          .rounds([5, 6])
          .do(),
        /Round result 1 is for round 9, not the round asked for, 6/
      );
      const ok0 = new StubClient([answer([5, 99, 5])]);
      const res = await new DTAlgodClient(ok0, '')
        .query({ program: PROGRAM, calls: [{}] })
        .rounds([5, 0, 5])
        .do();
      assert.deepStrictEqual(
        res.rounds.map((r) => r.round),
        [5n, 99n, 5n]
      );
    });

    it('checks the number of call results in rounds without an error', async () => {
      const stub = new StubClient([answer([5], 1)]);
      await assert.rejects(
        new DTAlgodClient(stub, '')
          .query({ program: PROGRAM, rounds: [5], calls: [{}, {}] })
          .do(),
        /Queried 2 calls but the node answered with 1 call results in round result 0/
      );
    });

    it('returns the raw body from doRaw', async () => {
      const body = algosdk.base64ToBytes(LIVE);
      const stub = new StubClient([() => ({ status: 200, body })]);
      const got = await new DTAlgodClient(stub, '')
        .query({ program: PROGRAM, calls: [{}] })
        .doRaw();
      assert.deepStrictEqual(got, body);
    });

    it('throws a node without queries as DTUnsupportedError', async () => {
      for (const handler of [
        () => ({ status: 404, json: { message: 'Not Found' } }),
        badRequest('query is disabled on this node (MaxAPIQueryCalls is 0)'),
      ]) {
        const stub = new StubClient([handler]);
        // eslint-disable-next-line no-await-in-loop
        await assert.rejects(
          new DTAlgodClient(stub, '')
            .query({ program: PROGRAM, calls: [{}] })
            .do(),
          (err) =>
            err instanceof DTUnsupportedError &&
            [400, 404].includes((err.cause as { status?: number }).status!)
        );
      }
    });

    it('passes other errors through', async () => {
      for (const handler of [
        badRequest('too many calls: got 1025, the limit is 1024'),
        badRequest('round 999999999 is after the latest round 66350609'),
        status(503),
        status(504),
      ]) {
        const stub = new StubClient([handler]);
        // eslint-disable-next-line no-await-in-loop
        await assert.rejects(
          new DTAlgodClient(stub, '')
            .query({ program: PROGRAM, calls: [{}] })
            .do(),
          (err) =>
            !(err instanceof DTUnsupportedError) &&
            !isQueryResponseTooLarge(err) &&
            [400, 503, 504].includes((err as { status?: number }).status!)
        );
      }
    });

    it('recognizes a response over maxResponseBytes', async () => {
      const stub = new StubClient([
        badRequest(
          'query response too large: the logs are over 67108864 bytes (MaxAPIQueryResponseBytes); query fewer calls or rounds'
        ),
      ]);
      const err = await new DTAlgodClient(stub, '')
        .query({ program: PROGRAM, calls: [{}] })
        .do()
        .then(
          () => undefined,
          (e) => e
        );
      assert.strictEqual(isQueryResponseTooLarge(err), true);
      assert.ok(!(err instanceof DTUnsupportedError));
      assert.strictEqual(
        isQueryResponseTooLarge(
          Object.assign(new Error('query response too large'), { status: 413 })
        ),
        false
      );
      assert.strictEqual(isQueryResponseTooLarge(new Error('x')), false);
      assert.strictEqual(isQueryResponseTooLarge(undefined), false);
      assert.strictEqual(
        isQueryResponseTooLarge('query response too large'),
        false
      );
    });

    it('accepts models and plain objects alike', async () => {
      const stub = new StubClient([answer([5]), answer([5])]);
      const client = new DTAlgodClient(stub, '');
      await client
        .query({
          program: PROGRAM,
          sender: ADDR,
          rounds: [5],
          calls: [{ accounts: [ADDR], boxes: [{ app: 3, name: 'AQ==' }] }],
        })
        .do();
      await client
        .query(
          new QueryRequest({
            program: programBytes,
            sender: algosdk.Address.fromString(ADDR),
            rounds: [5n],
            calls: [
              new QueryCall({
                accounts: [algosdk.Address.fromString(ADDR)],
                boxes: [
                  new algosdk.modelsv2.BoxReference({
                    app: 3n,
                    name: new Uint8Array([1]),
                  }),
                ],
              }),
            ],
          })
        )
        .do();
      assert.deepStrictEqual(sentBody(stub, 0), sentBody(stub, 1));
    });

    it('encodes JSON as the node takes it', () => {
      const request = new QueryRequest({
        program: PROGRAM,
        sender: ADDR,
        rounds: [0, 5],
        calls: [{ args: [utf8('hi')], foreignApps: [7] }],
      });
      const json = JSON.parse(algosdk.encodeJSON(request));
      assert.deepStrictEqual(json, {
        program: PROGRAM,
        sender: ADDR,
        rounds: [0, 5],
        calls: [{ args: ['aGk='], 'foreign-apps': [7] }],
      });
      const back = algosdk.decodeJSON(
        algosdk.encodeJSON(request),
        QueryRequest
      );
      assert.deepStrictEqual(back, request);
    });

    it('is a feature exported from the package', () => {
      assert.ok(DTAlgodClient.features.includes('query'));
      assert.strictEqual(algosdk.dtModels.QueryRequest, QueryRequest);
      assert.strictEqual(algosdk.dtModels.QueryLimits, QueryLimits);
      assert.strictEqual(
        algosdk.isQueryResponseTooLarge,
        isQueryResponseTooLarge
      );
      assert.strictEqual(algosdk.MAX_QUERY_REQUEST_BYTES, 1_000_000);
      assert.strictEqual(algosdk.QUERY_LOG_OVERHEAD_BYTES, 48);
    });
  });

  describe('reads at a round', () => {
    const addr = 'RETICA7ZSQTWPWFB7KTF4CPHJDPRXTPQYIMY6DOUQ72I2JD3T5RRDXTUSQ';

    it('checks the round of an account', async () => {
      const account = { address: addr, amount: 5, round: 120 };
      const stub = new StubClient([
        ok(account),
        ok({ ...account, round: 121 }),
      ]);
      const client = new DTAlgodClient(stub, '');

      const res = await client
        .accountInformation(addr)
        .exclude('all')
        .round(120)
        .do();
      assert.strictEqual(res.round, BigInt(120));
      assert.deepStrictEqual(stub.calls[0], {
        path: `/v2/accounts/${addr}`,
        query: { exclude: 'all', round: '120' },
      });
      await assert.rejects(
        client.accountInformation(addr).round(120).do(),
        DTUnsupportedError
      );
    });

    it('checks the current_round of the supply', async () => {
      const supply = { current_round: 9, 'online-money': 1, 'total-money': 2 };
      const stub = new StubClient([ok(supply), ok(supply)]);
      const client = new DTAlgodClient(stub, '');
      assert.strictEqual(
        (await client.supply().round(9).do()).currentRound,
        BigInt(9)
      );
      await assert.rejects(client.supply().round(8).do(), DTUnsupportedError);
    });

    it('sends round on asset and application lookups', async () => {
      const stub = new StubClient([
        ok({ index: 7, params: { creator: addr, decimals: 0, total: 1 } }),
        ok({ id: 8, params: { creator: addr } }),
      ]);
      const client = new DTAlgodClient(stub, '');
      await client.getAssetByID(7).round(3).do();
      await client.getApplicationByID(8).round(4).do();
      assert.deepStrictEqual(
        stub.calls.map((c) => [c.path, c.query.round]),
        [
          ['/v2/assets/7', '3'],
          ['/v2/applications/8', '4'],
        ]
      );
    });
  });

  describe('object versions', () => {
    const addr = 'RETICA7ZSQTWPWFB7KTF4CPHJDPRXTPQYIMY6DOUQ72I2JD3T5RRDXTUSQ';

    it('decodes account versions with only the changed objects', async () => {
      const stub = new StubClient([
        ok({
          round: 4500000,
          versions: [
            {
              round: 120,
              timestamp: 1700000123,
              base: {
                deleted: false,
                account: { address: addr, amount: 5000000, round: 120 },
              },
              assets: [
                {
                  'asset-id': 31566704,
                  deleted: false,
                  'asset-holding': {
                    amount: 10,
                    'asset-id': 31566704,
                    'is-frozen': false,
                  },
                },
              ],
              'apps-local-state': [{ 'app-id': 1002, deleted: true }],
            },
            {
              round: 130,
              timestamp: 1700000150,
              'created-apps': [{ 'app-id': 1003, deleted: false }],
            },
          ],
          'next-token': '131',
        }),
      ]);
      const res = await new DTAlgodClient(stub, '')
        .accountVersions(addr)
        .exclude('created-apps-params', 'created-assets-params')
        .include('values')
        .do();

      assert.deepStrictEqual(stub.calls[0], {
        path: `/v2/accounts/${addr}/versions`,
        query: {
          exclude: 'created-apps-params,created-assets-params',
          include: 'values',
        },
      });
      const [first, second] = res.versions;
      assert.strictEqual(first.base?.deleted, false);
      assert.strictEqual(first.base?.account?.amount, BigInt(5000000));
      assert.strictEqual(first.assets?.[0].assetId, BigInt(31566704));
      assert.strictEqual(first.assets?.[0].assetHolding?.amount, BigInt(10));
      assert.strictEqual(first.appsLocalState?.[0].deleted, true);
      assert.strictEqual(first.appsLocalState?.[0].appLocalState, undefined);
      assert.strictEqual(first.createdApps, undefined);
      assert.strictEqual(second.base, undefined);
      assert.strictEqual(second.createdApps?.[0].appId, BigInt(1003));
      assert.strictEqual(res.nextToken, '131');
    });

    it('builds the paths of the other versions endpoints', async () => {
      const empty = ok({ round: 1, versions: [] });
      const stub = new StubClient([empty, empty, empty, empty]);
      const client = new DTAlgodClient(stub, '');
      await client.getApplicationVersions(8).do();
      await client.getAssetVersions(7).do();
      await client.accountAssetVersions(addr, 7).do();
      await client.accountApplicationVersions(addr, 8).do();
      assert.deepStrictEqual(
        stub.calls.map((c) => c.path),
        [
          '/v2/applications/8/versions',
          '/v2/assets/7/versions',
          `/v2/accounts/${addr}/assets/7/versions`,
          `/v2/accounts/${addr}/applications/8/versions`,
        ]
      );
    });

    it("recognizes stock algod's 400 for a versions route it routes as an ID", async () => {
      const stub = new StubClient([
        () => ({
          status: 400,
          json: {
            message:
              'Invalid format for parameter asset-id: error binding string parameter: strconv.ParseUint: parsing "31566704/versions": invalid syntax',
          },
        }),
      ]);
      await assert.rejects(
        new DTAlgodClient(stub, '').getAssetVersions(31566704).do(),
        DTUnsupportedError
      );
    });

    it('decodes asset, application and created-object versions', async () => {
      const asset = {
        index: 7,
        params: { creator: addr, decimals: 6, total: 100, 'unit-name': 'USDC' },
      };
      const app = {
        id: 8,
        params: {
          creator: addr,
          'approval-program': 'AQ==',
          'clear-state-program': 'AQ==',
        },
      };
      const stub = new StubClient([
        ok({
          round: 9,
          versions: [
            { round: 2, timestamp: 20, deleted: false, asset },
            { round: 3, timestamp: 30, deleted: true },
          ],
        }),
        ok({
          round: 9,
          versions: [
            { round: 4, timestamp: 40, deleted: false, application: app },
          ],
        }),
        ok({
          round: 9,
          versions: [
            {
              round: 5,
              timestamp: 50,
              'created-assets': [{ 'asset-id': 7, deleted: false, asset }],
              'created-apps': [
                { 'app-id': 8, deleted: false, application: app },
              ],
              'apps-local-state': [
                {
                  'app-id': 8,
                  deleted: false,
                  'app-local-state': {
                    id: 8,
                    schema: { 'num-uint': 1, 'num-byte-slice': 0 },
                  },
                },
              ],
            },
          ],
        }),
      ]);
      const client = new DTAlgodClient(stub, '');

      const assets = await client.getAssetVersions(7).include('values').do();
      assert.strictEqual(assets.versions[0].asset?.params.unitName, 'USDC');
      assert.strictEqual(assets.versions[0].asset?.params.total, BigInt(100));
      assert.strictEqual(assets.versions[1].deleted, true);
      assert.strictEqual(assets.versions[1].asset, undefined);

      const apps = await client
        .getApplicationVersions(8)
        .include('values')
        .do();
      assert.strictEqual(apps.versions[0].application?.id, BigInt(8));
      assert.deepStrictEqual(
        apps.versions[0].application?.params.approvalProgram,
        new Uint8Array([1])
      );

      const [v] = (await client.accountVersions(addr).include('values').do())
        .versions;
      assert.strictEqual(v.createdAssets?.[0].assetId, BigInt(7));
      assert.strictEqual(v.createdAssets?.[0].asset?.params.decimals, 6);
      assert.strictEqual(v.createdApps?.[0].application?.id, BigInt(8));
      assert.strictEqual(v.appsLocalState?.[0].appId, BigInt(8));
      assert.strictEqual(
        v.appsLocalState?.[0].appLocalState?.schema.numUint,
        1
      );
    });

    it("passes the versions endpoints' own 400s through", async () => {
      const stub = new StubClient([
        badRequest(
          'Unable to parse next token: strconv.ParseUint: parsing "abc": invalid syntax'
        ),
      ]);
      await assert.rejects(
        new DTAlgodClient(stub, '').getApplicationVersions(8).next('abc').do(),
        (err: { status?: number }) =>
          !(err instanceof DTUnsupportedError) && err.status === 400
      );
    });

    it('reports a node without history as unsupported', async () => {
      const stub = new StubClient([
        badRequest('versions require EnableTimeTravel'),
        badRequest('versions require EnableTimeTravel'),
      ]);
      const client = new DTAlgodClient(stub, '');
      await assert.rejects(
        client.getAssetVersions(7).do(),
        (err: unknown) =>
          err instanceof DTUnsupportedError &&
          (err.cause as { status?: number }).status === 400
      );
      assert.strictEqual(await client.supportsDT(), false);
    });

    it('sends limit 0 instead of dropping it', async () => {
      const stub = new StubClient([ok({ round: 1, versions: [] })]);
      await new DTAlgodClient(stub, '').getAssetVersions(7).limit(0).do();
      assert.strictEqual(stub.calls[0].query.limit, '0');
    });

    it('iterates past empty pages and stops on an empty next-token', async () => {
      const v = (round: number) => ({ round, timestamp: round });
      const stub = new StubClient([
        ok({ round: 9, versions: [v(8)], 'next-token': '8' }),
        ok({ round: 9, versions: [], 'next-token': '6' }),
        ok({ round: 9, versions: [v(5)], 'next-token': '' }),
      ]);
      const request = new DTAlgodClient(stub, '')
        .accountVersions(addr)
        .minRound(0)
        .maxRound(9)
        .order('desc');
      const rounds: bigint[] = [];
      for await (const version of request.iterate()) rounds.push(version.round);

      assert.deepStrictEqual(rounds, [8, 5].map(BigInt));
      // Every page keeps the range and order.
      assert.deepStrictEqual(
        stub.calls.map((c) => c.query),
        [undefined, '8', '6'].map((next) => ({
          'min-round': '0',
          'max-round': '9',
          order: 'desc',
          ...(next === undefined ? {} : { next }),
        }))
      );
    });

    it('stops iterating with the error of a failed page', async () => {
      const stub = new StubClient([
        ok({
          round: 9,
          versions: [{ round: 1, timestamp: 1 }],
          'next-token': '1',
        }),
        status(404),
      ]);
      const rounds: bigint[] = [];
      await assert.rejects(async () => {
        for await (const version of new DTAlgodClient(stub, '')
          .getApplicationVersions(8)
          .iterate())
          rounds.push(version.round);
      }, DTUnsupportedError);
      assert.deepStrictEqual(rounds, [BigInt(1)]);
    });
  });

  describe('reads at a round: edge cases', () => {
    const addr = 'RETICA7ZSQTWPWFB7KTF4CPHJDPRXTPQYIMY6DOUQ72I2JD3T5RRDXTUSQ';

    it('checks the round of the account asset and application reads', async () => {
      const reads: Array<[unknown, (c: DTAlgodClient) => Promise<unknown>]> = [
        [{ round: 5 }, (c) => c.accountAssetInformation(addr, 7).round(4).do()],
        [
          { round: 5 },
          (c) => c.accountApplicationInformation(addr, 8).round(4).do(),
        ],
        [
          { round: 5, 'asset-holdings': [] },
          (c) => c.accountAssetsInformation(addr).round(4).do(),
        ],
        [
          { round: 5, 'apps-local-states': [] },
          (c) => c.accountApplicationsInformation(addr).round(4).do(),
        ],
      ];
      for (const [json, read] of reads) {
        const stub = new StubClient([
          ok(json),
          ok({ ...(json as object), round: 4 }),
        ]);
        const client = new DTAlgodClient(stub, '');
        // eslint-disable-next-line no-await-in-loop
        await assert.rejects(
          read(client),
          (err: unknown) =>
            err instanceof DTUnsupportedError && err.returnedRound === BigInt(5)
        );
        // eslint-disable-next-line no-await-in-loop
        await read(client);
        assert.strictEqual(stub.calls[1].query.round, '4');
      }
    });

    it('does not take a missing round for round 0', async () => {
      const stub = new StubClient([ok({ name: 'AA==', value: '' })]);
      await assert.rejects(
        new DTAlgodClient(stub, '')
          .getApplicationBoxByName(1, new Uint8Array([0]))
          .round(0)
          .do(),
        (err: unknown) =>
          err instanceof DTUnsupportedError && err.returnedRound === undefined
      );
    });

    it('checks the round in doRaw, and returns the body as received', async () => {
      const box = { round: 50, name: 'Y29uZmln', value: 'AAAAAAAAAAI=' };
      const stub = new StubClient([ok(box), ok(box)]);
      const client = new DTAlgodClient(stub, '');
      await assert.rejects(
        client.getApplicationBoxByName(1234, name).round(45).doRaw(),
        DTUnsupportedError
      );
      const raw = await client
        .getApplicationBoxByName(1234, name)
        .round(50)
        .doRaw();
      assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(raw)), box);
    });

    it('turns a refusal to read a past round into DTUnsupportedError', async () => {
      const stub = new StubClient([
        badRequest('looking up past rounds requires EnableTimeTravel'),
        badRequest('looking up past rounds requires EnableTimeTravel'),
        badRequest(
          'given round is no longer available; use a more recent round'
        ),
      ]);
      const client = new DTAlgodClient(stub, '');
      const isUnsupported = (err: unknown) =>
        err instanceof DTUnsupportedError &&
        err.requestedRound === BigInt(3) &&
        (err.cause as { status?: number }).status === 400;
      await assert.rejects(
        client.accountInformation(addr).round(3).do(),
        isUnsupported
      );
      // Including the reads whose round can't be checked.
      await assert.rejects(client.getAssetByID(7).round(3).do(), isUnsupported);
      await assert.rejects(
        client.getApplicationBoxes(1).round(3).do(),
        isUnsupported
      );
    });

    it('passes other 400s on reads at a round through', async () => {
      const stub = new StubClient([badRequest('round 99 is not available')]);
      await assert.rejects(
        new DTAlgodClient(stub, '').supply().round(99).do(),
        (err: { status?: number }) =>
          !(err instanceof DTUnsupportedError) && err.status === 400
      );
    });

    it('shares one probe between concurrent supportsDT calls', async () => {
      const stub = new StubClient([ok({ round: 1, versions: [] })]);
      const client = new DTAlgodClient(stub, '');
      assert.deepStrictEqual(
        await Promise.all([client.supportsDT(), client.supportsDT()]),
        [true, true]
      );
      assert.strictEqual(stub.calls.length, 1);
    });
  });
  describe('simulate', () => {
    const sender = 'RETICA7ZSQTWPWFB7KTF4CPHJDPRXTPQYIMY6DOUQ72I2JD3T5RRDXTUSQ';
    const payment = (amount: number) =>
      makePaymentTxnWithSuggestedParamsFromObject({
        sender,
        receiver: sender,
        amount,
        suggestedParams: {
          firstValid: 1,
          lastValid: 1000,
          fee: 1000,
          flatFee: true,
          minFee: 1000,
          genesisHash: new Uint8Array(32),
          genesisID: '',
        },
      });
    const stxn = (amount: number) =>
      new SignedTransaction({ txn: payment(amount) });
    const group = (...amounts: number[]) =>
      new SimulateRequestTransactionGroup({ txns: amounts.map(stxn) });
    const groupResult = (txn: SignedTransaction, failureMessage?: string) =>
      new SimulateTransactionGroupResult({
        txnResults: [
          new SimulateTransactionResult({
            txnResult: new PendingTransactionResponse({ txn, poolError: '' }),
          }),
        ],
        failureMessage,
        failedAt: failureMessage ? [0] : undefined,
      });
    const msgpack = (response: SimulateResponse) => () => ({
      status: 200,
      body: encodeMsgpack(response),
    });
    const sent = (stub: StubClient, i = 0) =>
      decodeMsgpack(stub.calls[i].body!, DTSimulateRequest);
    // Answers like the node: one result per requested group.
    const echo = (lastRound: number) => (call: Call) => ({
      status: 200,
      body: encodeMsgpack(
        new SimulateResponse({
          lastRound,
          version: 2,
          txnGroups: decodeMsgpack(call.body!, DTSimulateRequest).txnGroups.map(
            (g) => groupResult(g.txns[0])
          ),
        })
      ),
    });

    it('posts several groups and decodes one result per group', async () => {
      const response = new DTSimulateResponse({
        lastRound: 10,
        version: 2,
        txnGroups: [groupResult(stxn(1)), groupResult(stxn(2), 'overspend')],
        evalOverrides: new DTSimulationEvalOverrides({
          allowEmptySignatures: true,
          parallelGroups: true,
        }),
      });
      const stub = new StubClient([msgpack(response)]);
      const res = await new DTAlgodClient(stub, '')
        .simulateTransactions(
          new SimulateRequest({
            txnGroups: [group(1), group(2, 3)],
            allowEmptySignatures: true,
          })
        )
        .parallelGroups()
        .do();

      assert.strictEqual(stub.calls[0].path, '/v2/transactions/simulate');
      assert.strictEqual(stub.calls[0].query.format, 'msgpack');
      const req = sent(stub);
      assert.deepStrictEqual(
        req.txnGroups.map((g) => g.txns.map((t) => t.txn.payment!.amount)),
        [[BigInt(1)], [BigInt(2), BigInt(3)]]
      );
      assert.strictEqual(req.parallelGroups, true);
      assert.strictEqual(req.allowEmptySignatures, true);

      assert.ok(res instanceof DTSimulateResponse);
      assert.strictEqual(res.txnGroups.length, 2);
      assert.strictEqual(res.txnGroups[0].failureMessage, undefined);
      assert.strictEqual(res.txnGroups[1].failureMessage, 'overspend');
      assert.deepStrictEqual(res.txnGroups[1].failedAt, [0]);
      assert.ok(res.evalOverrides instanceof DTSimulationEvalOverrides);
      assert.strictEqual(res.evalOverrides!.parallelGroups, true);
      assert.strictEqual(res.evalOverrides!.allowEmptySignatures, true);
    });

    it('needs the fork models to see parallel-groups in the response', () => {
      const bytes = encodeMsgpack(
        new DTSimulateResponse({
          lastRound: 1,
          version: 2,
          txnGroups: [],
          evalOverrides: new DTSimulationEvalOverrides({
            parallelGroups: true,
          }),
        })
      );
      // The stock model drops the key it does not know.
      const stock = decodeMsgpack(bytes, SimulateResponse);
      assert.ok(stock.evalOverrides);
      assert.ok(!('parallelGroups' in stock.evalOverrides!));
      assert.strictEqual(
        decodeMsgpack(bytes, DTSimulateResponse).evalOverrides!.parallelGroups,
        true
      );
    });

    it('decodes a stock response', async () => {
      const response = new SimulateResponse({
        lastRound: 10,
        version: 2,
        txnGroups: [groupResult(stxn(1))],
      });
      const stub = new StubClient([msgpack(response)]);
      const res = await new DTAlgodClient(stub, '')
        .simulateTransactions(new SimulateRequest({ txnGroups: [group(1)] }))
        .do();
      assert.strictEqual(res.lastRound, BigInt(10));
      assert.strictEqual(res.txnGroups.length, 1);
      assert.strictEqual(res.evalOverrides, undefined);
    });

    it('sends a plain request unchanged, without parallel-groups', async () => {
      const request = new SimulateRequest({
        txnGroups: [group(1)],
        allowEmptySignatures: true,
        allowMoreLogging: true,
        allowUnnamedResources: true,
        execTraceConfig: new SimulateTraceConfig({
          enable: true,
          stackChange: true,
        }),
        extraOpcodeBudget: 700,
        fixSigners: true,
        round: 42,
      });
      const stub = new StubClient([echo(42)]);
      await new DTAlgodClient(stub, '')
        .simulateTransactions(request)
        .parallelGroups(false)
        .do();
      // Byte-identical to what AlgodClient sends.
      assert.deepStrictEqual(stub.calls[0].body, encodeMsgpack(request));
    });

    it('copies every field of the generated models', () => {
      // The fork models copy the generated fields one by one. A field added
      // by regenerating models/types.ts must be added to them too.
      const keys = (schema: unknown) =>
        (schema as NamedMapSchema).getEntries().map((e) => e.key);
      assert.deepStrictEqual(keys(SimulateRequest.encodingSchema), [
        'txn-groups',
        'allow-empty-signatures',
        'allow-more-logging',
        'allow-unnamed-resources',
        'exec-trace-config',
        'extra-opcode-budget',
        'fix-signers',
        'round',
      ]);
      assert.deepStrictEqual(keys(SimulationEvalOverrides.encodingSchema), [
        'allow-empty-signatures',
        'allow-unnamed-resources',
        'extra-opcode-budget',
        'fix-signers',
        'max-log-calls',
        'max-log-size',
      ]);
    });

    it('takes the request as it was when the call was made', async () => {
      const stub = new StubClient([echo(1)]);
      const request = new SimulateRequest({ txnGroups: [group(1)] });
      const call = new DTAlgodClient(stub, '').simulateTransactions(request);
      request.txnGroups.push(group(2));
      request.allowEmptySignatures = true;
      await call.do();
      assert.strictEqual(sent(stub).txnGroups.length, 1);
      assert.strictEqual(sent(stub).allowEmptySignatures, undefined);
    });

    it('keeps parallelGroups set on a DTSimulateRequest', async () => {
      const stub = new StubClient([echo(1)]);
      await new DTAlgodClient(stub, '')
        .simulateTransactions(
          new DTSimulateRequest({
            txnGroups: [group(1), group(2)],
            parallelGroups: true,
          })
        )
        .do();
      assert.strictEqual(sent(stub).parallelGroups, true);
    });

    it('takes several groups of raw transactions', async () => {
      const raw = (amount: number) => encodeMsgpack(stxn(amount));
      const stub = new StubClient([echo(1), echo(1), echo(1)]);
      const client = new DTAlgodClient(stub, '');
      await client.simulateRawTransactions([[raw(1)], [raw(2), raw(3)]]).do();
      await client.simulateRawTransactions([raw(4), raw(5)]).do();
      await client.simulateRawTransactions(raw(6)).do();
      const amounts = (i: number) =>
        sent(stub, i).txnGroups.map((g) =>
          g.txns.map((t) => Number(t.txn.payment!.amount))
        );
      assert.deepStrictEqual(amounts(0), [[1], [2, 3]]);
      assert.deepStrictEqual(amounts(1), [[4, 5]]);
      assert.deepStrictEqual(amounts(2), [[6]]);
    });

    // What stock algod answers, from its handler's decode and simulator.
    const stockOneGroup = badRequest('expected 1 transaction group, got 2');
    const stockUnknownField = badRequest(
      'failed to decode object: json decode error [pos 1]: only encoded map or array can be decoded into a struct'
    );
    const isUnsupported = (err: unknown) =>
      err instanceof DTUnsupportedError &&
      (err.cause as { status?: number }).status === 400;
    const isPlain400 = (err: unknown) =>
      !(err instanceof DTUnsupportedError) &&
      (err as { status?: number }).status === 400;

    it("reports stock algod's one-group limit as unsupported", async () => {
      const stub = new StubClient([stockOneGroup]);
      await assert.rejects(
        new DTAlgodClient(stub, '')
          .simulateTransactions(
            new SimulateRequest({ txnGroups: [group(1), group(2)] })
          )
          .do(),
        (err: unknown) =>
          isUnsupported(err) &&
          /only one transaction group per request, and this request has 2/.test(
            (err as Error).message
          )
      );
    });

    it("reports stock algod's rejection of parallel-groups as unsupported", async () => {
      const stub = new StubClient([stockUnknownField]);
      await assert.rejects(
        new DTAlgodClient(stub, '')
          .simulateTransactions(new SimulateRequest({ txnGroups: [group(1)] }))
          .parallelGroups()
          .do(),
        (err: unknown) =>
          isUnsupported(err) && /parallel-groups/.test((err as Error).message)
      );
    });

    it('passes 400s through when the request uses no fork feature', async () => {
      const stub = new StubClient([
        stockOneGroup,
        stockUnknownField,
        stockUnknownField,
      ]);
      const client = new DTAlgodClient(stub, '');
      const single = () =>
        client
          .simulateTransactions(new SimulateRequest({ txnGroups: [group(1)] }))
          .do();
      await assert.rejects(single(), isPlain400);
      await assert.rejects(single(), isPlain400);
      // Several groups use no fork field, so a decode failure is not about one.
      await assert.rejects(
        client
          .simulateTransactions(
            new SimulateRequest({ txnGroups: [group(1), group(2)] })
          )
          .do(),
        isPlain400
      );
    });

    it("passes the fork's own 400s through", async () => {
      const stub = new StubClient([
        badRequest('too many transaction groups: got 20, the limit is 16'),
        badRequest('FixSigners requires AllowEmptySignatures to be enabled'),
      ]);
      const client = new DTAlgodClient(stub, '');
      await assert.rejects(
        client
          .simulateTransactions(
            new SimulateRequest({ txnGroups: [group(1), group(2)] })
          )
          .parallelGroups()
          .do(),
        isPlain400
      );
      await assert.rejects(
        client
          .simulateTransactions(
            new SimulateRequest({
              txnGroups: [group(1), group(2)],
              fixSigners: true,
            })
          )
          .parallelGroups()
          .do(),
        isPlain400
      );
    });

    describe('rounds', () => {
      const roundsResponse = (...results: SimulateRoundResult[]) =>
        new DTSimulateResponse({
          lastRound: 0,
          version: 2,
          txnGroups: [],
          roundResults: results,
        });
      const at = (round: number, ...failures: Array<string | undefined>) =>
        new SimulateRoundResult({
          lastRound: round,
          txnGroups: failures.map((f) => groupResult(stxn(1), f)),
          initialStates: new SimulateInitialStates({
            appInitialStates: [new ApplicationInitialStates({ id: 9 })],
          }),
        });
      const failedAt = (round: number, error: string) =>
        new SimulateRoundResult({ lastRound: round, txnGroups: [], error });
      const simulateAt = (stub: StubClient, rounds: number[]) =>
        new DTAlgodClient(stub, '')
          .simulateTransactions(
            new SimulateRequest({
              txnGroups: [group(1), group(2)],
              allowEmptySignatures: true,
            })
          )
          .rounds(rounds);

      it('sends rounds and decodes one result per entry', async () => {
        const stub = new StubClient([
          msgpack(
            roundsResponse(
              at(100, undefined, 'overspend'),
              failedAt(999999999, 'round 999999999 is not available'),
              at(120, undefined, undefined)
            )
          ),
        ]);
        const res = await simulateAt(stub, [100, 999999999, 0]).do();

        assert.deepStrictEqual(sent(stub).rounds, [
          BigInt(100),
          BigInt(999999999),
          BigInt(0),
        ]);
        assert.strictEqual(sent(stub).round, undefined);
        assert.strictEqual(res.lastRound, BigInt(0));
        assert.deepStrictEqual(res.txnGroups, []);
        const results = res.roundResults!;
        assert.ok(results.every((r) => r instanceof SimulateRoundResult));
        assert.deepStrictEqual(
          results.map((r) => r.lastRound),
          [BigInt(100), BigInt(999999999), BigInt(120)]
        );
        assert.deepStrictEqual(
          results[0].txnGroups.map((g) => g.failureMessage),
          [undefined, 'overspend']
        );
        assert.strictEqual(
          results[0].initialStates!.appInitialStates![0].id,
          BigInt(9)
        );
        assert.strictEqual(results[0].error, undefined);
        assert.strictEqual(
          results[1].error,
          'round 999999999 is not available'
        );
        assert.deepStrictEqual(results[1].txnGroups, []);
        assert.strictEqual(results[1].initialStates, undefined);
        assert.strictEqual(results[2].txnGroups.length, 2);
      });

      it('keeps duplicate and 0 entries, in request order', async () => {
        const stub = new StubClient([
          msgpack(
            roundsResponse(
              at(5, undefined, undefined),
              at(5, undefined, undefined),
              at(5, undefined, undefined)
            )
          ),
        ]);
        const res = await simulateAt(stub, [5, 5, 0]).do();
        assert.deepStrictEqual(sent(stub).rounds, [
          BigInt(5),
          BigInt(5),
          BigInt(0),
        ]);
        assert.strictEqual(res.roundResults!.length, 3);
      });

      it('sends no rounds for an empty list', async () => {
        const request = new SimulateRequest({ txnGroups: [group(1)] });
        const stub = new StubClient([echo(9)]);
        const res = await new DTAlgodClient(stub, '')
          .simulateTransactions(request)
          .rounds([])
          .do();
        assert.deepStrictEqual(stub.calls[0].body, encodeMsgpack(request));
        assert.strictEqual(res.roundResults, undefined);
      });

      it('takes rounds set on a DTSimulateRequest', async () => {
        const stub = new StubClient([
          msgpack(roundsResponse(at(7, undefined))),
        ]);
        const res = await new DTAlgodClient(stub, '')
          .simulateTransactions(
            new DTSimulateRequest({
              txnGroups: [group(1)],
              rounds: [7],
              round: 0,
            })
          )
          .do();
        assert.deepStrictEqual(sent(stub).rounds, [BigInt(7)]);
        assert.strictEqual(res.roundResults![0].lastRound, BigInt(7));
      });

      it('refuses round together with rounds before sending', async () => {
        const stub = new StubClient([]);
        await assert.rejects(
          new DTAlgodClient(stub, '')
            .simulateTransactions(
              new SimulateRequest({ txnGroups: [group(1)], round: 3 })
            )
            .rounds([4])
            .do(),
          /Cannot simulate at round 3 and at rounds/
        );
        assert.strictEqual(stub.calls.length, 0);
      });

      it('checks there is one result per entry', async () => {
        const stub = new StubClient([
          msgpack(
            new SimulateResponse({ lastRound: 5, version: 2, txnGroups: [] })
          ),
          msgpack(roundsResponse(at(5))),
        ]);
        await assert.rejects(
          simulateAt(stub, [5, 6]).do(),
          (err: unknown) =>
            err instanceof DTUnsupportedError &&
            /no round-results/.test(err.message)
        );
        await assert.rejects(
          simulateAt(stub, [5, 6]).do(),
          (err: unknown) =>
            err instanceof DTUnsupportedError &&
            /answered with 1 round results/.test(err.message)
        );
      });

      it('checks each result is for the round asked for', async () => {
        const stub = new StubClient([
          msgpack(roundsResponse(at(5), at(7))),
          msgpack(
            roundsResponse(
              at(5, undefined, undefined),
              at(8, undefined, undefined)
            )
          ),
        ]);
        await assert.rejects(
          simulateAt(stub, [5, 6]).do(),
          (err: unknown) =>
            err instanceof DTUnsupportedError &&
            err.requestedRound === BigInt(6) &&
            err.returnedRound === BigInt(7)
        );
        // A 0 entry accepts whatever round the node resolved it to.
        const res = await simulateAt(stub, [5, 0]).do();
        assert.strictEqual(res.roundResults![1].lastRound, BigInt(8));
      });

      it('checks the round results in doRaw, and returns the body', async () => {
        const good = encodeMsgpack(roundsResponse(at(5, undefined, undefined)));
        const stub = new StubClient([
          () => ({ status: 200, body: good }),
          msgpack(roundsResponse(at(6))),
        ]);
        assert.deepStrictEqual(await simulateAt(stub, [5]).doRaw(), good);
        await assert.rejects(simulateAt(stub, [5]).doRaw(), DTUnsupportedError);
      });

      it("reports stock algod's rejection of rounds as unsupported", async () => {
        const stub = new StubClient([stockUnknownField]);
        await assert.rejects(
          new DTAlgodClient(stub, '')
            .simulateTransactions(
              new SimulateRequest({ txnGroups: [group(1)] })
            )
            .rounds([5])
            .do(),
          (err: unknown) =>
            isUnsupported(err) && /rounds/.test((err as Error).message)
        );
      });

      it("passes the fork's rounds 400s through", async () => {
        const stub = new StubClient([
          badRequest('too many rounds: got 20, the limit is 16'),
          badRequest(
            'rounds is disabled on this node (MaxAPISimulateRounds is 0)'
          ),
        ]);
        await assert.rejects(simulateAt(stub, [1]).do(), isPlain400);
        await assert.rejects(simulateAt(stub, [1]).do(), isPlain400);
      });
    });

    it('checks there is one group result per requested group', async () => {
      const stub = new StubClient([
        msgpack(
          new SimulateResponse({
            lastRound: 1,
            version: 2,
            txnGroups: [groupResult(stxn(1))],
          })
        ),
        msgpack(
          new DTSimulateResponse({
            lastRound: 0,
            version: 2,
            txnGroups: [],
            roundResults: [
              // A round that could not be simulated has no group results.
              new SimulateRoundResult({
                lastRound: 5,
                txnGroups: [],
                error: 'round 5 is not available',
              }),
              new SimulateRoundResult({
                lastRound: 6,
                txnGroups: [groupResult(stxn(1))],
              }),
            ],
          })
        ),
      ]);
      const client = new DTAlgodClient(stub, '');
      const request = new SimulateRequest({ txnGroups: [group(1), group(2)] });
      await assert.rejects(
        client.simulateTransactions(request).do(),
        (err: unknown) =>
          err instanceof DTUnsupportedError &&
          /Simulated 2 transaction groups but the node answered with 1 group results$/.test(
            err.message
          )
      );
      await assert.rejects(
        client.simulateTransactions(request).rounds([5, 6]).do(),
        (err: unknown) =>
          err instanceof DTUnsupportedError &&
          /answered with 1 group results in round result 1$/.test(err.message)
      );
    });

    it('sends rounds and parallel-groups from a stock request', async () => {
      const stock = new SimulateRequest({
        txnGroups: [group(1), group(2)],
        allowUnnamedResources: true,
        extraOpcodeBudget: 700,
      });
      const stub = new StubClient([
        msgpack(
          new DTSimulateResponse({
            lastRound: 0,
            version: 2,
            txnGroups: [],
            roundResults: [
              new SimulateRoundResult({
                lastRound: 5,
                txnGroups: [groupResult(stxn(1)), groupResult(stxn(2))],
              }),
            ],
          })
        ),
      ]);
      const res = await new DTAlgodClient(stub, '')
        .simulateTransactions(stock)
        .parallelGroups()
        .rounds([5])
        .do();
      const req = sent(stub);
      assert.strictEqual(req.parallelGroups, true);
      assert.deepStrictEqual(req.rounds, [BigInt(5)]);
      assert.strictEqual(req.allowUnnamedResources, true);
      assert.strictEqual(req.extraOpcodeBudget, 700);
      assert.ok(res.groupResult(1, 0).ok);
    });

    describe('DTAlgodClient.from', () => {
      it('reuses the HTTP client of an AlgodClient', async () => {
        const algod = new AlgodClient('token', 'http://localhost', 4001, {
          'X-Extra': 'yes',
        });
        const client = DTAlgodClient.from(algod);
        assert.ok(client instanceof DTAlgodClient);
        assert.notStrictEqual(client, algod);
        // Same server, token and headers: they all live in the base client.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assert.strictEqual((client.c as any).bc, (algod.c as any).bc);

        const stub = new StubClient([echo(3)]);
        const res = await DTAlgodClient.from(new AlgodClient(stub, ''))
          .simulateTransactions(
            new SimulateRequest({ txnGroups: [group(1), group(2)] })
          )
          .do();
        assert.strictEqual(stub.calls.length, 1);
        assert.ok(res instanceof DTSimulateResponse);
        assert.strictEqual(res.lastRound, BigInt(3));
      });

      it('takes a client shaped like an AlgodClient from another copy', async () => {
        const stub = new StubClient([echo(4)]);
        const foreign = { c: { bc: stub } } as unknown as AlgodClient;
        const res = await DTAlgodClient.from(foreign)
          .simulateTransactions(new SimulateRequest({ txnGroups: [group(1)] }))
          .do();
        assert.strictEqual(stub.calls.length, 1);
        assert.strictEqual(res.lastRound, BigInt(4));
      });

      it('returns the same client for the same AlgodClient', () => {
        const algod = new AlgodClient(new StubClient([]), '');
        const client = DTAlgodClient.from(algod);
        assert.strictEqual(DTAlgodClient.from(algod), client);
        assert.notStrictEqual(
          DTAlgodClient.from(new AlgodClient(new StubClient([]), '')),
          client
        );
      });

      it('returns a DTAlgodClient as it is', () => {
        const client = new DTAlgodClient(new StubClient([]), '');
        assert.strictEqual(DTAlgodClient.from(client), client);
      });

      it('refuses what is not an AlgodClient', () => {
        const notClients = [
          undefined,
          {},
          { c: {} },
          { c: { bc: { get() {}, post() {} } } },
        ];
        for (const value of notClients) {
          assert.throws(
            () => DTAlgodClient.from(value as unknown as AlgodClient),
            TypeError
          );
        }
      });

      it('is found with its features on the package', () => {
        assert.strictEqual(algosdk.DTAlgodClient, DTAlgodClient);
        for (const feature of [
          'from',
          'group-results',
          'from-transactions',
          'pack-rounds',
          'simulate-rounds',
          'validity-window',
          'simulate-protocol',
        ]) {
          assert.ok(DTAlgodClient.features.includes(feature), feature);
        }
        assert.strictEqual(algosdk.SimulateGroupError, SimulateGroupError);
        assert.strictEqual(algosdk.packSimulateRounds, packSimulateRounds);
      });
    });

    describe('groupResult', () => {
      const notSimulated =
        'not simulated: an earlier group failed a post-evaluation check';
      const topLevel = new DTSimulateResponse({
        lastRound: 10,
        version: 2,
        txnGroups: [
          groupResult(stxn(1)),
          groupResult(stxn(2), 'overspend'),
          groupResult(stxn(3), notSimulated),
        ],
      });
      const withRounds = new DTSimulateResponse({
        lastRound: 0,
        version: 2,
        txnGroups: [],
        roundResults: [
          new SimulateRoundResult({
            lastRound: 100,
            txnGroups: [
              groupResult(stxn(1)),
              groupResult(stxn(2), 'overspend'),
            ],
          }),
          new SimulateRoundResult({
            lastRound: 200,
            txnGroups: [],
            error: 'round 200 is not available',
          }),
        ],
      });
      const errorOf = (outcome: algosdk.SimulateGroupOutcome) => {
        assert.strictEqual(outcome.ok, false);
        if (outcome.ok) throw new Error('unreachable');
        assert.ok(outcome.error instanceof SimulateGroupError);
        assert.ok(outcome.error instanceof Error);
        return outcome.error;
      };

      it('returns the result of a group that ran', () => {
        const outcome = topLevel.groupResult(0);
        assert.ok(outcome.ok);
        assert.strictEqual(outcome.result, topLevel.txnGroups[0]);
        assert.strictEqual(outcome.round, BigInt(10));
        assert.strictEqual(outcome.roundIndex, 0);
        assert.strictEqual(outcome.groupIndex, 0);
      });

      it('reports a failed group with where it failed', () => {
        const error = errorOf(topLevel.groupResult(1));
        assert.strictEqual(error.kind, 'group');
        assert.strictEqual(error.failureMessage, 'overspend');
        assert.deepStrictEqual(error.failedAt, [0]);
        assert.strictEqual(error.result, topLevel.txnGroups[1]);
        assert.strictEqual(error.round, BigInt(10));
        assert.strictEqual(
          error.message,
          'Simulating group 1 at round 10 failed at transaction 0: overspend'
        );
      });

      it('reports a group that was not simulated', () => {
        const error = errorOf(topLevel.groupResult(2));
        assert.strictEqual(error.kind, 'not-simulated');
        assert.strictEqual(
          error.failureMessage,
          'an earlier group failed a post-evaluation check'
        );
        assert.strictEqual(error.result, topLevel.txnGroups[2]);
      });

      it('reports a missing group', () => {
        const error = errorOf(topLevel.groupResult(3));
        assert.strictEqual(error.kind, 'missing');
        assert.strictEqual(error.result, undefined);
      });

      it('reports every group of a round that could not be simulated', () => {
        for (const g of [0, 1, 5]) {
          const error = errorOf(withRounds.groupResult(g, 1));
          assert.strictEqual(error.kind, 'round');
          assert.strictEqual(
            error.failureMessage,
            'round 200 is not available'
          );
          assert.strictEqual(error.round, BigInt(200));
          assert.strictEqual(error.roundIndex, 1);
          assert.strictEqual(error.groupIndex, g);
        }
        assert.ok(withRounds.groupResult(0, 0).ok);
        assert.strictEqual(errorOf(withRounds.groupResult(1, 0)).kind, 'group');
      });

      it('refuses indexes out of range', () => {
        assert.throws(() => topLevel.groupResult(0, 1), RangeError);
        assert.throws(() => topLevel.groupResult(-1), RangeError);
        assert.throws(() => topLevel.groupResult(0.5), RangeError);
        assert.throws(() => withRounds.groupResult(0, 2), RangeError);
        assert.throws(() => withRounds.groupResult(0, -1), RangeError);
      });

      it('lists every outcome by round and group', () => {
        const kind = (o: algosdk.SimulateGroupOutcome) =>
          o.ok ? 'ok' : o.error.kind;
        assert.deepStrictEqual(
          topLevel.groupResults().map((r) => r.map(kind)),
          [['ok', 'group', 'not-simulated']]
        );
        assert.deepStrictEqual(
          withRounds.groupResults().map((r) => r.map(kind)),
          [
            ['ok', 'group'],
            ['round', 'round'],
          ]
        );
        assert.deepStrictEqual(
          withRounds.groupResults(3).map((r) => r.map(kind)),
          [
            ['ok', 'group', 'missing'],
            ['round', 'round', 'round'],
          ]
        );
      });
    });

    describe('groupResults from a call', () => {
      const roundError = (round: number) =>
        new SimulateRoundResult({
          lastRound: round,
          txnGroups: [],
          error: `round ${round} is not available`,
        });
      const call = (stub: StubClient) =>
        new DTAlgodClient(stub, '')
          .simulateTransactions(
            new SimulateRequest({ txnGroups: [group(1), group(2)] })
          )
          .rounds([5]);

      it('has a row of errors for each round that failed', async () => {
        const stub = new StubClient([
          msgpack(
            new DTSimulateResponse({
              lastRound: 0,
              version: 2,
              txnGroups: [],
              roundResults: [roundError(5)],
            })
          ),
        ]);
        const res = await call(stub).do();
        assert.strictEqual(res.requestGroupCount, 2);
        assert.deepStrictEqual(
          res
            .groupResults()
            .map((row) => row.map((o) => (o.ok ? 'ok' : o.error.kind))),
          [['round', 'round']]
        );
      });

      it('checks the group results in doRaw', async () => {
        const stub = new StubClient([
          msgpack(
            new DTSimulateResponse({
              lastRound: 0,
              version: 2,
              txnGroups: [],
              roundResults: [
                new SimulateRoundResult({
                  lastRound: 5,
                  txnGroups: [groupResult(stxn(1))],
                }),
              ],
            })
          ),
        ]);
        await assert.rejects(
          call(stub).doRaw(),
          (err: unknown) =>
            err instanceof DTUnsupportedError &&
            /answered with 1 group results in round result 0$/.test(err.message)
        );
      });
    });

    describe('DTSimulateRequest.fromTransactions', () => {
      it('wraps transactions and assigns missing group IDs', () => {
        const single = payment(1);
        const pair = [payment(2), payment(3)];
        const grouped = assignGroupID([payment(4), payment(5)]);
        const groupedID = grouped[0].group;
        const request = DTSimulateRequest.fromTransactions(
          [[single], pair, grouped],
          { allowUnnamedResources: true, parallelGroups: true, rounds: [7] }
        );

        assert.strictEqual(request.allowEmptySignatures, true);
        assert.strictEqual(request.allowUnnamedResources, true);
        assert.strictEqual(request.parallelGroups, true);
        assert.deepStrictEqual(request.rounds, [BigInt(7)]);
        assert.strictEqual(request.txnGroups.length, 3);
        assert.strictEqual(request.txnGroups[0].txns[0].txn, single);
        assert.strictEqual(single.group, undefined);
        const pairID = computeGroupID([payment(2), payment(3)]);
        assert.deepStrictEqual(pair[0].group, pairID);
        assert.deepStrictEqual(pair[1].group, pairID);
        assert.strictEqual(grouped[0].group, groupedID);
        for (const g of request.txnGroups) {
          for (const t of g.txns) assert.strictEqual(t.sig, undefined);
        }
        const decoded = decodeMsgpack(
          encodeMsgpack(request),
          DTSimulateRequest
        );
        assert.deepStrictEqual(decoded.txnGroups[1].txns[1].txn.group, pairID);
        assert.deepStrictEqual(decoded.rounds, [BigInt(7)]);
      });

      it('leaves a group where any transaction has a group ID', () => {
        const first = assignGroupID([payment(1), payment(2)])[0];
        const second = payment(3);
        DTSimulateRequest.fromTransactions([[first, second]]);
        assert.strictEqual(second.group, undefined);
      });

      it('lets allowEmptySignatures be turned off, and refuses empty groups', () => {
        assert.strictEqual(
          DTSimulateRequest.fromTransactions([[payment(1)]], {
            allowEmptySignatures: false,
          }).allowEmptySignatures,
          false
        );
        assert.throws(
          () => DTSimulateRequest.fromTransactions([[payment(1)], []]),
          /Transaction group 1 is empty/
        );
      });
    });

    describe('validity window modes and protocol', () => {
      const request = (fields: { allowEmptySignatures?: boolean } = {}) =>
        new SimulateRequest({
          txnGroups: [group(1), group(2)],
          allowEmptySignatures: true,
          ...fields,
        });
      const roundResult = (
        round: number,
        protocolOverride?: SimulateProtocolOverride
      ) =>
        new SimulateRoundResult({
          lastRound: round,
          txnGroups: [groupResult(stxn(1)), groupResult(stxn(2))],
          protocolOverride,
        });
      const response = ({
        evalOverrides,
        protocolOverride,
        roundResults,
      }: {
        evalOverrides?: DTSimulationEvalOverrides;
        protocolOverride?: SimulateProtocolOverride;
        roundResults?: SimulateRoundResult[];
      }) =>
        new DTSimulateResponse({
          lastRound: roundResults ? 0 : 10,
          version: 2,
          txnGroups: roundResults
            ? []
            : [groupResult(stxn(1)), groupResult(stxn(2))],
          evalOverrides,
          protocolOverride,
          roundResults,
        });
      const override = (from: string, to: string) =>
        new SimulateProtocolOverride({
          from,
          to,
          applied: from !== to,
          notes:
            from !== to
              ? [
                  new SimulateProtocolNote({
                    code: 'semantics-changed',
                    message: 'LogicSigMsig: true → false',
                  }),
                  new SimulateProtocolNote({
                    code: 'block-incentive-fields',
                    message: 'BlkProposer reads as zero',
                    hits: [
                      new SimulateProtocolNoteHit({ group: 0, path: [0] }),
                      new SimulateProtocolNoteHit({ group: 1, path: [0, 2] }),
                    ],
                  }),
                ]
              : undefined,
        });

      it('sends skip-validity-window and reads its echo', async () => {
        const stub = new StubClient([
          msgpack(
            response({
              evalOverrides: new DTSimulationEvalOverrides({
                allowEmptySignatures: true,
                skipValidityWindow: true,
              }),
              roundResults: [roundResult(100), roundResult(5000)],
            })
          ),
        ]);
        const res = await new DTAlgodClient(stub, '')
          .simulateTransactions(request())
          .rounds([100, 5000])
          .skipValidityWindow()
          .do();
        const req = sent(stub);
        assert.strictEqual(req.skipValidityWindow, true);
        assert.strictEqual(req.rewriteValidityWindow, undefined);
        assert.strictEqual(res.evalOverrides!.skipValidityWindow, true);
        assert.strictEqual(res.roundResults!.length, 2);
      });

      it('sends rewrite-validity-window and reads its echo', async () => {
        const stub = new StubClient([
          msgpack(
            response({
              evalOverrides: new DTSimulationEvalOverrides({
                allowEmptySignatures: true,
                rewriteValidityWindow: true,
              }),
              roundResults: [roundResult(100), roundResult(5000)],
            })
          ),
        ]);
        const res = await new DTAlgodClient(stub, '')
          .simulateTransactions(request())
          .rounds([100, 5000])
          .rewriteValidityWindow()
          .do();
        assert.strictEqual(sent(stub).rewriteValidityWindow, true);
        assert.strictEqual(sent(stub).skipValidityWindow, undefined);
        assert.strictEqual(res.evalOverrides!.rewriteValidityWindow, true);
      });

      it('sends neither mode when turned off', async () => {
        const stub = new StubClient([
          msgpack(response({ roundResults: [roundResult(100)] })),
        ]);
        await new DTAlgodClient(stub, '')
          .simulateTransactions(request())
          .rounds([100])
          .skipValidityWindow()
          .skipValidityWindow(false)
          .do();
        assert.strictEqual(sent(stub).skipValidityWindow, undefined);
      });

      it('refuses invalid combinations before sending', async () => {
        const cases: [
          (call: ReturnType<DTAlgodClient['simulateTransactions']>) => unknown,
          RegExp,
          boolean?,
        ][] = [
          [
            (c) => c.rounds([1]).skipValidityWindow().rewriteValidityWindow(),
            /both skip and rewrite/,
          ],
          [(c) => c.skipValidityWindow(), /skipValidityWindow requires rounds/],
          [
            (c) => c.rounds([]).rewriteValidityWindow(),
            /rewriteValidityWindow requires rounds/,
          ],
          [
            (c) => c.rounds([1]).rewriteValidityWindow(),
            /requires allowEmptySignatures/,
            false,
          ],
        ];
        for (const [build, message, allowEmptySignatures] of cases) {
          const stub = new StubClient([]);
          const call = new DTAlgodClient(stub, '').simulateTransactions(
            request({ allowEmptySignatures: allowEmptySignatures ?? true })
          );
          build(call);
          // eslint-disable-next-line no-await-in-loop
          await assert.rejects(call.do(), message);
          assert.strictEqual(stub.calls.length, 0);
        }
      });

      it('throws DTUnsupportedError when a mode is not echoed', async () => {
        const stub = new StubClient([
          msgpack(
            response({
              evalOverrides: new DTSimulationEvalOverrides({
                allowEmptySignatures: true,
              }),
              roundResults: [roundResult(100)],
            })
          ),
        ]);
        await assert.rejects(
          new DTAlgodClient(stub, '')
            .simulateTransactions(request())
            .rounds([100])
            .skipValidityWindow()
            .do(),
          (err: Error) =>
            err instanceof DTUnsupportedError &&
            /skip-validity-window/.test(err.message)
        );
      });

      it('sends protocol and decodes the override at the top level', async () => {
        const stub = new StubClient([
          msgpack(
            response({ protocolOverride: override('v35', 'future-ish') })
          ),
        ]);
        const res = await new DTAlgodClient(stub, '')
          .simulateTransactions(request())
          .protocol('latest')
          .do();
        assert.strictEqual(sent(stub).protocol, 'latest');
        const po = res.protocolOverride!;
        assert.ok(po instanceof SimulateProtocolOverride);
        assert.strictEqual(po.from, 'v35');
        assert.strictEqual(po.to, 'future-ish');
        assert.strictEqual(po.applied, true);
        assert.deepStrictEqual(
          po.notes!.map((n) => n.code),
          ['semantics-changed', 'block-incentive-fields']
        );
        assert.strictEqual(po.notes![0].hits, undefined);
        assert.ok(po.notes![1].hits![0] instanceof SimulateProtocolNoteHit);
        assert.deepStrictEqual(
          po.notes![1].hits!.map((h) => [h.group, h.path]),
          [
            [0, [0]],
            [1, [0, 2]],
          ]
        );
      });

      it('decodes a protocol that was not applied', async () => {
        const stub = new StubClient([
          msgpack(response({ protocolOverride: override('v42', 'v42') })),
        ]);
        const res = await new DTAlgodClient(stub, '')
          .simulateTransactions(request())
          .protocol('v42')
          .do();
        assert.strictEqual(res.protocolOverride!.applied, false);
        assert.strictEqual(res.protocolOverride!.notes, undefined);
      });

      it('decodes an override per round, none for a round error', async () => {
        const stub = new StubClient([
          msgpack(
            response({
              evalOverrides: new DTSimulationEvalOverrides({
                allowEmptySignatures: true,
                rewriteValidityWindow: true,
              }),
              roundResults: [
                roundResult(100, override('v24', 'v42')),
                new SimulateRoundResult({
                  lastRound: 1,
                  txnGroups: [],
                  error: 'v42 is not a later protocol',
                }),
                roundResult(5000, override('v42', 'v42')),
              ],
            })
          ),
        ]);
        const res = await new DTAlgodClient(stub, '')
          .simulateTransactions(request())
          .rounds([100, 1, 5000])
          .rewriteValidityWindow()
          .protocol('v42')
          .do();
        assert.strictEqual(res.protocolOverride, undefined);
        const results = res.roundResults!;
        assert.strictEqual(results[0].protocolOverride!.from, 'v24');
        assert.strictEqual(results[1].protocolOverride, undefined);
        assert.strictEqual(results[2].protocolOverride!.applied, false);
      });

      it('throws DTUnsupportedError when protocol-override is missing', async () => {
        const single = new StubClient([msgpack(response({}))]);
        await assert.rejects(
          new DTAlgodClient(single, '')
            .simulateTransactions(request())
            .protocol('v42')
            .do(),
          (err: Error) =>
            err instanceof DTUnsupportedError &&
            /without a protocol-override;/.test(err.message)
        );
        const rounds = new StubClient([
          msgpack(
            response({
              roundResults: [
                roundResult(100, override('v24', 'v42')),
                roundResult(200),
              ],
            })
          ),
        ]);
        await assert.rejects(
          new DTAlgodClient(rounds, '')
            .simulateTransactions(request())
            .rounds([100, 200])
            .protocol('v42')
            .doRaw(),
          (err: Error) =>
            err instanceof DTUnsupportedError &&
            /in round result 1/.test(err.message)
        );
      });

      it('sends no protocol for an empty string', async () => {
        const stub = new StubClient([msgpack(response({}))]);
        await new DTAlgodClient(stub, '')
          .simulateTransactions(request())
          .protocol('v42')
          .protocol('')
          .do();
        assert.strictEqual(sent(stub).protocol, undefined);
      });

      it('names protocol when a node cannot decode it', async () => {
        const stub = new StubClient([
          badRequest(
            'failed to decode object: json decode error [pos 1]: only encoded map or array can be decoded into a struct'
          ),
        ]);
        await assert.rejects(
          new DTAlgodClient(stub, '')
            .simulateTransactions(request())
            .protocol('v42')
            .do(),
          (err: Error) =>
            err instanceof DTUnsupportedError &&
            /sets protocol/.test(err.message)
        );
      });

      it('encodes applied false and group 0 like the node', () => {
        const bytes = encodeMsgpack(
          new SimulateProtocolOverride({
            from: 'v42',
            to: 'v42',
            applied: false,
            notes: [
              new SimulateProtocolNote({
                code: 'block-hash-fields',
                message: 'm',
                hits: [new SimulateProtocolNoteHit({ group: 0, path: [0] })],
              }),
            ],
          })
        );
        const raw = algosdk.decodeObj(bytes) as Record<string, unknown>;
        assert.strictEqual(raw.applied, false);
        const hit = (raw.notes as Record<string, unknown>[])[0].hits as Record<
          string,
          unknown
        >[];
        assert.strictEqual(hit[0].group, 0);
      });

      it('keeps the new fields when copying and encoding a request', () => {
        const original = new DTSimulateRequest({
          txnGroups: [group(1)],
          allowEmptySignatures: true,
          rounds: [1, 2],
          rewriteValidityWindow: true,
          protocol: 'v42',
        });
        const copy = DTSimulateRequest.from(original);
        assert.strictEqual(copy.rewriteValidityWindow, true);
        assert.strictEqual(copy.protocol, 'v42');
        const decoded = decodeMsgpack(
          encodeMsgpack(
            new DTSimulateRequest({
              txnGroups: [group(1)],
              skipValidityWindow: true,
              protocol: 'latest',
            })
          ),
          DTSimulateRequest
        );
        assert.strictEqual(decoded.skipValidityWindow, true);
        assert.strictEqual(decoded.rewriteValidityWindow, undefined);
        assert.strictEqual(decoded.protocol, 'latest');
      });
    });

    describe('packSimulateRounds', () => {
      const b = (...xs: number[]) => xs.map(BigInt);

      it('packs rounds into windows a transaction can be valid for', () => {
        const { windows, positions } = packSimulateRounds([
          100,
          1100,
          BigInt(1101),
          50,
          100,
        ]);
        assert.deepStrictEqual(windows, [
          {
            rounds: b(50, 100),
            firstValid: BigInt(51),
            lastValid: BigInt(101),
          },
          {
            rounds: b(1100, 1101),
            firstValid: BigInt(1101),
            lastValid: BigInt(1102),
          },
        ]);
        assert.deepStrictEqual(positions, [
          { window: 0, roundIndex: 1 },
          { window: 1, roundIndex: 0 },
          { window: 1, roundIndex: 1 },
          { window: 0, roundIndex: 0 },
          { window: 0, roundIndex: 1 },
        ]);
      });

      it('spans at most MaxTxnLife rounds', () => {
        const fits = packSimulateRounds([1, 1001]).windows;
        assert.strictEqual(fits.length, 1);
        assert.strictEqual(
          fits[0].lastValid - fits[0].firstValid,
          BigInt(1000)
        );
        assert.deepStrictEqual(
          packSimulateRounds([1, 1002]).windows.map((w) => w.rounds),
          [b(1), b(1002)]
        );
        assert.deepStrictEqual(
          packSimulateRounds([1, 3, 6], { maxSpan: 2 }).windows.map(
            (w) => w.rounds
          ),
          [b(1, 3), b(6)]
        );
      });

      it('lists at most maxRounds rounds per window', () => {
        const rounds = Array.from({ length: 20 }, (_, i) => i + 1);
        assert.deepStrictEqual(
          packSimulateRounds(rounds).windows.map((w) => w.rounds.length),
          [16, 4]
        );
        assert.deepStrictEqual(
          packSimulateRounds([1, 2, 3], { maxRounds: 2 }).windows.map(
            (w) => w.rounds
          ),
          [b(1, 2), b(3)]
        );
      });

      it('packs by maxRounds only with maxSpan null', () => {
        const { windows } = packSimulateRounds([1, 5000, 3000000, 2], {
          maxSpan: null,
          maxRounds: 3,
        });
        assert.deepStrictEqual(
          windows.map((w) => w.rounds),
          [b(1, 2, 5000), b(3000000)]
        );
        assert.strictEqual(windows[0].firstValid, BigInt(2));
        assert.strictEqual(windows[0].lastValid, BigInt(1002));
        assert.strictEqual(windows[1].lastValid, BigInt(3000001));
      });

      it('refuses round 0 and bad options', () => {
        assert.throws(() => packSimulateRounds([5, 0]), RangeError);
        assert.throws(
          () => packSimulateRounds([5], { maxRounds: 0 }),
          (err: Error) =>
            err instanceof RangeError &&
            /does not simulate at several rounds/.test(err.message)
        );
        assert.throws(
          () => packSimulateRounds([5], { maxRounds: 1.5 }),
          RangeError
        );
        assert.throws(() => packSimulateRounds([-1]));
        assert.deepStrictEqual(packSimulateRounds([]), {
          windows: [],
          positions: [],
        });
      });
    });

    it('works under AtomicTransactionComposer.simulate', async () => {
      const stub = new StubClient([
        (call) => {
          const req = decodeMsgpack(call.body!, DTSimulateRequest);
          return {
            status: 200,
            body: encodeMsgpack(
              new SimulateResponse({
                lastRound: 1,
                version: 2,
                txnGroups: [groupResult(req.txnGroups[0].txns[0])],
              })
            ),
          };
        },
      ]);
      const atc = new AtomicTransactionComposer();
      atc.addTransaction({
        txn: payment(1),
        signer: makeEmptyTransactionSigner(),
      });
      const { simulateResponse } = await atc.simulate(
        new DTAlgodClient(stub, ''),
        new SimulateRequest({ txnGroups: [], allowEmptySignatures: true })
      );
      assert.ok(simulateResponse instanceof DTSimulateResponse);
      assert.strictEqual(sent(stub).txnGroups.length, 1);
    });
  });
});
