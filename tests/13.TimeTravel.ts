/* eslint-env mocha */
import assert from 'assert';
import {
  BaseHTTPClient,
  BaseHTTPClientResponse,
  Query,
} from '../src/client/baseHTTPClient';
import {
  TimeTravelAlgodClient,
  TimeTravelUnsupportedError,
  BoxVersion,
  BoxChange,
  BoxesVersion,
  SimulateRoundResult,
  TimeTravelSimulateRequest,
  TimeTravelSimulateResponse,
  TimeTravelSimulationEvalOverrides,
  SimulateGroupError,
  packSimulateRounds,
} from '../src/client/v2/algod/timeTravel/index';
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
      const box = await new TimeTravelAlgodClient(stub, '')
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
      await new TimeTravelAlgodClient(stub, '')
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
        new TimeTravelAlgodClient(stub, '')
          .getApplicationBoxByName(1234, name)
          .round(45000000)
          .do(),
        (err: unknown) =>
          err instanceof TimeTravelUnsupportedError &&
          err.requestedRound === BigInt(45000000) &&
          err.returnedRound === BigInt(50000000)
      );
    });

    it('does not check the round when none was asked for', async () => {
      const stub = new StubClient([
        ok({ round: 50000000, name: 'Y29uZmln', value: 'AAAAAAAAAAI=' }),
      ]);
      const box = await new TimeTravelAlgodClient(stub, '')
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
        new TimeTravelAlgodClient(stub, '')
          .getApplicationBoxes(1)
          .round(6)
          .do(),
        TimeTravelUnsupportedError
      );
    });

    it('accepts a response for the asked round', async () => {
      const stub = new StubClient([
        ok({ round: 6, boxes: [{ name: 'AA==' }], 'next-token': 'b64:AA==' }),
      ]);
      const res = await new TimeTravelAlgodClient(stub, '')
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
      const res = await new TimeTravelAlgodClient(stub, '')
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
      const request = new TimeTravelAlgodClient(stub, '')
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

    it('turns a 404 into TimeTravelUnsupportedError', async () => {
      const stub = new StubClient([status(404)]);
      await assert.rejects(
        new TimeTravelAlgodClient(stub, '')
          .getApplicationBoxVersions(1, name)
          .do(),
        TimeTravelUnsupportedError
      );
    });

    it('passes other errors through', async () => {
      const stub = new StubClient([status(400)]);
      await assert.rejects(
        new TimeTravelAlgodClient(stub, '')
          .getApplicationBoxVersions(1, name)
          .do(),
        (err: { status?: number }) =>
          !(err instanceof TimeTravelUnsupportedError) && err.status === 400
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
      const res = await new TimeTravelAlgodClient(stub, '')
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
      const res = await new TimeTravelAlgodClient(stub, '')
        .getApplicationBoxesVersions(1)
        .do();

      assert.strictEqual(stub.calls[0].query.include, undefined);
      assert.strictEqual(res.versions[0].boxes[0].value, undefined);
      assert.strictEqual(res.nextToken, undefined);
    });

    it('decodes an empty page', async () => {
      const stub = new StubClient([ok({ round: 9, versions: [] })]);
      const res = await new TimeTravelAlgodClient(stub, '')
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
      const request = new TimeTravelAlgodClient(stub, '')
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
        new TimeTravelAlgodClient(stub, '').getApplicationBoxesVersions(1).do(),
        TimeTravelUnsupportedError
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
        new TimeTravelAlgodClient(stub, '')
          .getApplicationBoxesVersions(1)
          .next('x/versions')
          .do(),
        (err: { status?: number }) =>
          !(err instanceof TimeTravelUnsupportedError) && err.status === 400
      );
    });

    it('turns a 404 into TimeTravelUnsupportedError', async () => {
      const stub = new StubClient([status(404)]);
      await assert.rejects(
        new TimeTravelAlgodClient(stub, '').getApplicationBoxesVersions(1).do(),
        TimeTravelUnsupportedError
      );
    });

    it('passes a 503 for an incomplete box index through', async () => {
      const stub = new StubClient([status(503)]);
      await assert.rejects(
        new TimeTravelAlgodClient(stub, '').getApplicationBoxesVersions(1).do(),
        (err: { status?: number }) =>
          !(err instanceof TimeTravelUnsupportedError) &&
          err.status === 503 &&
          /nope/.test(String((err as { message?: string }).message))
      );
    });
  });

  describe('supportsTimeTravel', () => {
    it('is true when the versions route answers, and is cached', async () => {
      const stub = new StubClient([ok({ round: 1, versions: [] })]);
      const client = new TimeTravelAlgodClient(stub, '');
      assert.strictEqual(await client.supportsTimeTravel(), true);
      assert.strictEqual(await client.supportsTimeTravel(), true);
      assert.strictEqual(stub.calls.length, 1);
    });

    it('is true when the route rejects the probe with 400', async () => {
      const stub = new StubClient([status(400)]);
      assert.strictEqual(
        await new TimeTravelAlgodClient(stub, '').supportsTimeTravel(),
        true
      );
    });

    it('is false when the route is missing', async () => {
      const stub = new StubClient([status(404)]);
      assert.strictEqual(
        await new TimeTravelAlgodClient(stub, '').supportsTimeTravel(),
        false
      );
    });

    it('rethrows other errors without caching them', async () => {
      const stub = new StubClient([
        status(401),
        ok({ round: 1, versions: [] }),
      ]);
      const client = new TimeTravelAlgodClient(stub, '');
      await assert.rejects(client.supportsTimeTravel());
      assert.strictEqual(await client.supportsTimeTravel(), true);
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
      const client = new TimeTravelAlgodClient(stub, '');

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
        TimeTravelUnsupportedError
      );
    });

    it('checks the current_round of the supply', async () => {
      const supply = { current_round: 9, 'online-money': 1, 'total-money': 2 };
      const stub = new StubClient([ok(supply), ok(supply)]);
      const client = new TimeTravelAlgodClient(stub, '');
      assert.strictEqual(
        (await client.supply().round(9).do()).currentRound,
        BigInt(9)
      );
      await assert.rejects(
        client.supply().round(8).do(),
        TimeTravelUnsupportedError
      );
    });

    it('sends round on asset and application lookups', async () => {
      const stub = new StubClient([
        ok({ index: 7, params: { creator: addr, decimals: 0, total: 1 } }),
        ok({ id: 8, params: { creator: addr } }),
      ]);
      const client = new TimeTravelAlgodClient(stub, '');
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
      const res = await new TimeTravelAlgodClient(stub, '')
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
      const client = new TimeTravelAlgodClient(stub, '');
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
        new TimeTravelAlgodClient(stub, '').getAssetVersions(31566704).do(),
        TimeTravelUnsupportedError
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
      const client = new TimeTravelAlgodClient(stub, '');

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
        new TimeTravelAlgodClient(stub, '')
          .getApplicationVersions(8)
          .next('abc')
          .do(),
        (err: { status?: number }) =>
          !(err instanceof TimeTravelUnsupportedError) && err.status === 400
      );
    });

    it('reports a node without history as unsupported', async () => {
      const stub = new StubClient([
        badRequest('versions require EnableTimeTravel'),
        badRequest('versions require EnableTimeTravel'),
      ]);
      const client = new TimeTravelAlgodClient(stub, '');
      await assert.rejects(
        client.getAssetVersions(7).do(),
        (err: unknown) =>
          err instanceof TimeTravelUnsupportedError &&
          (err.cause as { status?: number }).status === 400
      );
      assert.strictEqual(await client.supportsTimeTravel(), false);
    });

    it('sends limit 0 instead of dropping it', async () => {
      const stub = new StubClient([ok({ round: 1, versions: [] })]);
      await new TimeTravelAlgodClient(stub, '')
        .getAssetVersions(7)
        .limit(0)
        .do();
      assert.strictEqual(stub.calls[0].query.limit, '0');
    });

    it('iterates past empty pages and stops on an empty next-token', async () => {
      const v = (round: number) => ({ round, timestamp: round });
      const stub = new StubClient([
        ok({ round: 9, versions: [v(8)], 'next-token': '8' }),
        ok({ round: 9, versions: [], 'next-token': '6' }),
        ok({ round: 9, versions: [v(5)], 'next-token': '' }),
      ]);
      const request = new TimeTravelAlgodClient(stub, '')
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
        for await (const version of new TimeTravelAlgodClient(stub, '')
          .getApplicationVersions(8)
          .iterate())
          rounds.push(version.round);
      }, TimeTravelUnsupportedError);
      assert.deepStrictEqual(rounds, [BigInt(1)]);
    });
  });

  describe('reads at a round: edge cases', () => {
    const addr = 'RETICA7ZSQTWPWFB7KTF4CPHJDPRXTPQYIMY6DOUQ72I2JD3T5RRDXTUSQ';

    it('checks the round of the account asset and application reads', async () => {
      const reads: Array<
        [unknown, (c: TimeTravelAlgodClient) => Promise<unknown>]
      > = [
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
        const client = new TimeTravelAlgodClient(stub, '');
        // eslint-disable-next-line no-await-in-loop
        await assert.rejects(
          read(client),
          (err: unknown) =>
            err instanceof TimeTravelUnsupportedError &&
            err.returnedRound === BigInt(5)
        );
        // eslint-disable-next-line no-await-in-loop
        await read(client);
        assert.strictEqual(stub.calls[1].query.round, '4');
      }
    });

    it('does not take a missing round for round 0', async () => {
      const stub = new StubClient([ok({ name: 'AA==', value: '' })]);
      await assert.rejects(
        new TimeTravelAlgodClient(stub, '')
          .getApplicationBoxByName(1, new Uint8Array([0]))
          .round(0)
          .do(),
        (err: unknown) =>
          err instanceof TimeTravelUnsupportedError &&
          err.returnedRound === undefined
      );
    });

    it('checks the round in doRaw, and returns the body as received', async () => {
      const box = { round: 50, name: 'Y29uZmln', value: 'AAAAAAAAAAI=' };
      const stub = new StubClient([ok(box), ok(box)]);
      const client = new TimeTravelAlgodClient(stub, '');
      await assert.rejects(
        client.getApplicationBoxByName(1234, name).round(45).doRaw(),
        TimeTravelUnsupportedError
      );
      const raw = await client
        .getApplicationBoxByName(1234, name)
        .round(50)
        .doRaw();
      assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(raw)), box);
    });

    it('turns a refusal to read a past round into TimeTravelUnsupportedError', async () => {
      const stub = new StubClient([
        badRequest('looking up past rounds requires EnableTimeTravel'),
        badRequest('looking up past rounds requires EnableTimeTravel'),
        badRequest(
          'given round is no longer available; use a more recent round'
        ),
      ]);
      const client = new TimeTravelAlgodClient(stub, '');
      const isUnsupported = (err: unknown) =>
        err instanceof TimeTravelUnsupportedError &&
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
        new TimeTravelAlgodClient(stub, '').supply().round(99).do(),
        (err: { status?: number }) =>
          !(err instanceof TimeTravelUnsupportedError) && err.status === 400
      );
    });

    it('shares one probe between concurrent supportsTimeTravel calls', async () => {
      const stub = new StubClient([ok({ round: 1, versions: [] })]);
      const client = new TimeTravelAlgodClient(stub, '');
      assert.deepStrictEqual(
        await Promise.all([
          client.supportsTimeTravel(),
          client.supportsTimeTravel(),
        ]),
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
      decodeMsgpack(stub.calls[i].body!, TimeTravelSimulateRequest);
    // Answers like the node: one result per requested group.
    const echo = (lastRound: number) => (call: Call) => ({
      status: 200,
      body: encodeMsgpack(
        new SimulateResponse({
          lastRound,
          version: 2,
          txnGroups: decodeMsgpack(
            call.body!,
            TimeTravelSimulateRequest
          ).txnGroups.map((g) => groupResult(g.txns[0])),
        })
      ),
    });

    it('posts several groups and decodes one result per group', async () => {
      const response = new TimeTravelSimulateResponse({
        lastRound: 10,
        version: 2,
        txnGroups: [groupResult(stxn(1)), groupResult(stxn(2), 'overspend')],
        evalOverrides: new TimeTravelSimulationEvalOverrides({
          allowEmptySignatures: true,
          parallelGroups: true,
        }),
      });
      const stub = new StubClient([msgpack(response)]);
      const res = await new TimeTravelAlgodClient(stub, '')
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

      assert.ok(res instanceof TimeTravelSimulateResponse);
      assert.strictEqual(res.txnGroups.length, 2);
      assert.strictEqual(res.txnGroups[0].failureMessage, undefined);
      assert.strictEqual(res.txnGroups[1].failureMessage, 'overspend');
      assert.deepStrictEqual(res.txnGroups[1].failedAt, [0]);
      assert.ok(res.evalOverrides instanceof TimeTravelSimulationEvalOverrides);
      assert.strictEqual(res.evalOverrides!.parallelGroups, true);
      assert.strictEqual(res.evalOverrides!.allowEmptySignatures, true);
    });

    it('needs the fork models to see parallel-groups in the response', () => {
      const bytes = encodeMsgpack(
        new TimeTravelSimulateResponse({
          lastRound: 1,
          version: 2,
          txnGroups: [],
          evalOverrides: new TimeTravelSimulationEvalOverrides({
            parallelGroups: true,
          }),
        })
      );
      // The stock model drops the key it does not know.
      const stock = decodeMsgpack(bytes, SimulateResponse);
      assert.ok(stock.evalOverrides);
      assert.ok(!('parallelGroups' in stock.evalOverrides!));
      assert.strictEqual(
        decodeMsgpack(bytes, TimeTravelSimulateResponse).evalOverrides!
          .parallelGroups,
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
      const res = await new TimeTravelAlgodClient(stub, '')
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
      await new TimeTravelAlgodClient(stub, '')
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
      const call = new TimeTravelAlgodClient(stub, '').simulateTransactions(
        request
      );
      request.txnGroups.push(group(2));
      request.allowEmptySignatures = true;
      await call.do();
      assert.strictEqual(sent(stub).txnGroups.length, 1);
      assert.strictEqual(sent(stub).allowEmptySignatures, undefined);
    });

    it('keeps parallelGroups set on a TimeTravelSimulateRequest', async () => {
      const stub = new StubClient([echo(1)]);
      await new TimeTravelAlgodClient(stub, '')
        .simulateTransactions(
          new TimeTravelSimulateRequest({
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
      const client = new TimeTravelAlgodClient(stub, '');
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
      err instanceof TimeTravelUnsupportedError &&
      (err.cause as { status?: number }).status === 400;
    const isPlain400 = (err: unknown) =>
      !(err instanceof TimeTravelUnsupportedError) &&
      (err as { status?: number }).status === 400;

    it("reports stock algod's one-group limit as unsupported", async () => {
      const stub = new StubClient([stockOneGroup]);
      await assert.rejects(
        new TimeTravelAlgodClient(stub, '')
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
        new TimeTravelAlgodClient(stub, '')
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
      const client = new TimeTravelAlgodClient(stub, '');
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
      const client = new TimeTravelAlgodClient(stub, '');
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
        new TimeTravelSimulateResponse({
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
        new TimeTravelAlgodClient(stub, '')
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
        const res = await new TimeTravelAlgodClient(stub, '')
          .simulateTransactions(request)
          .rounds([])
          .do();
        assert.deepStrictEqual(stub.calls[0].body, encodeMsgpack(request));
        assert.strictEqual(res.roundResults, undefined);
      });

      it('takes rounds set on a TimeTravelSimulateRequest', async () => {
        const stub = new StubClient([
          msgpack(roundsResponse(at(7, undefined))),
        ]);
        const res = await new TimeTravelAlgodClient(stub, '')
          .simulateTransactions(
            new TimeTravelSimulateRequest({
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
          new TimeTravelAlgodClient(stub, '')
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
            err instanceof TimeTravelUnsupportedError &&
            /no round-results/.test(err.message)
        );
        await assert.rejects(
          simulateAt(stub, [5, 6]).do(),
          (err: unknown) =>
            err instanceof TimeTravelUnsupportedError &&
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
            err instanceof TimeTravelUnsupportedError &&
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
        await assert.rejects(
          simulateAt(stub, [5]).doRaw(),
          TimeTravelUnsupportedError
        );
      });

      it("reports stock algod's rejection of rounds as unsupported", async () => {
        const stub = new StubClient([stockUnknownField]);
        await assert.rejects(
          new TimeTravelAlgodClient(stub, '')
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
          new TimeTravelSimulateResponse({
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
      const client = new TimeTravelAlgodClient(stub, '');
      const request = new SimulateRequest({ txnGroups: [group(1), group(2)] });
      await assert.rejects(
        client.simulateTransactions(request).do(),
        (err: unknown) =>
          err instanceof TimeTravelUnsupportedError &&
          /Simulated 2 transaction groups but the node answered with 1 group results$/.test(
            err.message
          )
      );
      await assert.rejects(
        client.simulateTransactions(request).rounds([5, 6]).do(),
        (err: unknown) =>
          err instanceof TimeTravelUnsupportedError &&
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
          new TimeTravelSimulateResponse({
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
      const res = await new TimeTravelAlgodClient(stub, '')
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

    describe('TimeTravelAlgodClient.from', () => {
      it('reuses the HTTP client of an AlgodClient', async () => {
        const algod = new AlgodClient('token', 'http://localhost', 4001, {
          'X-Extra': 'yes',
        });
        const client = TimeTravelAlgodClient.from(algod);
        assert.ok(client instanceof TimeTravelAlgodClient);
        assert.notStrictEqual(client, algod);
        // Same server, token and headers: they all live in the base client.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assert.strictEqual((client.c as any).bc, (algod.c as any).bc);

        const stub = new StubClient([echo(3)]);
        const res = await TimeTravelAlgodClient.from(new AlgodClient(stub, ''))
          .simulateTransactions(
            new SimulateRequest({ txnGroups: [group(1), group(2)] })
          )
          .do();
        assert.strictEqual(stub.calls.length, 1);
        assert.ok(res instanceof TimeTravelSimulateResponse);
        assert.strictEqual(res.lastRound, BigInt(3));
      });

      it('takes a client shaped like an AlgodClient from another copy', async () => {
        const stub = new StubClient([echo(4)]);
        const foreign = { c: { bc: stub } } as unknown as AlgodClient;
        const res = await TimeTravelAlgodClient.from(foreign)
          .simulateTransactions(new SimulateRequest({ txnGroups: [group(1)] }))
          .do();
        assert.strictEqual(stub.calls.length, 1);
        assert.strictEqual(res.lastRound, BigInt(4));
      });

      it('returns the same client for the same AlgodClient', () => {
        const algod = new AlgodClient(new StubClient([]), '');
        const client = TimeTravelAlgodClient.from(algod);
        assert.strictEqual(TimeTravelAlgodClient.from(algod), client);
        assert.notStrictEqual(
          TimeTravelAlgodClient.from(new AlgodClient(new StubClient([]), '')),
          client
        );
      });

      it('returns a TimeTravelAlgodClient as it is', () => {
        const client = new TimeTravelAlgodClient(new StubClient([]), '');
        assert.strictEqual(TimeTravelAlgodClient.from(client), client);
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
            () => TimeTravelAlgodClient.from(value as unknown as AlgodClient),
            TypeError
          );
        }
      });

      it('is found with its features on the package', () => {
        assert.strictEqual(
          algosdk.TimeTravelAlgodClient,
          TimeTravelAlgodClient
        );
        for (const feature of [
          'from',
          'group-results',
          'from-transactions',
          'pack-rounds',
          'simulate-rounds',
        ]) {
          assert.ok(TimeTravelAlgodClient.features.includes(feature), feature);
        }
        assert.strictEqual(algosdk.SimulateGroupError, SimulateGroupError);
        assert.strictEqual(algosdk.packSimulateRounds, packSimulateRounds);
      });
    });

    describe('groupResult', () => {
      const notSimulated =
        'not simulated: an earlier group failed a post-evaluation check';
      const topLevel = new TimeTravelSimulateResponse({
        lastRound: 10,
        version: 2,
        txnGroups: [
          groupResult(stxn(1)),
          groupResult(stxn(2), 'overspend'),
          groupResult(stxn(3), notSimulated),
        ],
      });
      const withRounds = new TimeTravelSimulateResponse({
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
        new TimeTravelAlgodClient(stub, '')
          .simulateTransactions(
            new SimulateRequest({ txnGroups: [group(1), group(2)] })
          )
          .rounds([5]);

      it('has a row of errors for each round that failed', async () => {
        const stub = new StubClient([
          msgpack(
            new TimeTravelSimulateResponse({
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
            new TimeTravelSimulateResponse({
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
            err instanceof TimeTravelUnsupportedError &&
            /answered with 1 group results in round result 0$/.test(err.message)
        );
      });
    });

    describe('TimeTravelSimulateRequest.fromTransactions', () => {
      it('wraps transactions and assigns missing group IDs', () => {
        const single = payment(1);
        const pair = [payment(2), payment(3)];
        const grouped = assignGroupID([payment(4), payment(5)]);
        const groupedID = grouped[0].group;
        const request = TimeTravelSimulateRequest.fromTransactions(
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
          TimeTravelSimulateRequest
        );
        assert.deepStrictEqual(decoded.txnGroups[1].txns[1].txn.group, pairID);
        assert.deepStrictEqual(decoded.rounds, [BigInt(7)]);
      });

      it('leaves a group where any transaction has a group ID', () => {
        const first = assignGroupID([payment(1), payment(2)])[0];
        const second = payment(3);
        TimeTravelSimulateRequest.fromTransactions([[first, second]]);
        assert.strictEqual(second.group, undefined);
      });

      it('lets allowEmptySignatures be turned off, and refuses empty groups', () => {
        assert.strictEqual(
          TimeTravelSimulateRequest.fromTransactions([[payment(1)]], {
            allowEmptySignatures: false,
          }).allowEmptySignatures,
          false
        );
        assert.throws(
          () => TimeTravelSimulateRequest.fromTransactions([[payment(1)], []]),
          /Transaction group 1 is empty/
        );
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

      it('refuses round 0 and bad options', () => {
        assert.throws(() => packSimulateRounds([5, 0]), RangeError);
        assert.throws(
          () => packSimulateRounds([5], { maxRounds: 0 }),
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
          const req = decodeMsgpack(call.body!, TimeTravelSimulateRequest);
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
        new TimeTravelAlgodClient(stub, ''),
        new SimulateRequest({ txnGroups: [], allowEmptySignatures: true })
      );
      assert.ok(simulateResponse instanceof TimeTravelSimulateResponse);
      assert.strictEqual(sent(stub).txnGroups.length, 1);
    });
  });
});
