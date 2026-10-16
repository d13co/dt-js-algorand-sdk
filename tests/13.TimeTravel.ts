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
} from '../src/client/v2/algod/timeTravel/index';

type Call = { path: string; query: Query<string> };

/**
 * A BaseHTTPClient that answers each GET with the next queued handler.
 */
class StubClient implements BaseHTTPClient {
  calls: Call[] = [];

  private handlers: Array<(call: Call) => { status: number; json: unknown }>;

  constructor(
    handlers: Array<(call: Call) => { status: number; json: unknown }>
  ) {
    this.handlers = handlers;
  }

  async get(
    path: string,
    query?: Query<string>
  ): Promise<BaseHTTPClientResponse> {
    const call = { path, query: { ...(query ?? {}) } };
    this.calls.push(call);
    const handler = this.handlers.shift();
    if (!handler) throw new Error(`unexpected request ${path}`);
    const { status, json } = handler(call);
    const response = {
      body: new TextEncoder().encode(JSON.stringify(json)),
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

  // eslint-disable-next-line class-methods-use-this
  post(): Promise<BaseHTTPClientResponse> {
    throw new Error('not implemented');
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
});
