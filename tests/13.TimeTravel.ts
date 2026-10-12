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
      throw Object.assign(new Error(`status ${status}`), { response });
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
        limit: 3,
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
      assert.ok(stub.calls.every((c) => c.query.limit === 2));
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
});
