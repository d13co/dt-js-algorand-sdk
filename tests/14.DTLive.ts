/* eslint-env mocha */
/**
 * Live checks of DTAlgodClient against a real MainNet time-travel node
 * (`EnableTimeTravel: true`). Skipped unless DT_ALGOD_SERVER is set:
 *
 *   DT_ALGOD_SERVER=http://10.114.0.27:4000 npx mocha --import=tsx tests/14.DTLive.ts
 *
 * DT_ALGOD_TOKEN sets the API token, if the node needs one.
 */
import assert from 'assert';
import {
  DTAlgodClient,
  DTSimulateRequest,
  DTUnsupportedError,
  QueryLimits,
  EFFORT_HEADER,
  effortOf,
} from '../src/client/v2/algod/dt/index';
import { SimulateRequestTransactionGroup } from '../src/client/v2/algod/models/types';
import { makePaymentTxnWithSuggestedParamsFromObject } from '../src/makeTxn';
import { SignedTransaction } from '../src/signedTransaction';
import { Transaction } from '../src/transaction';
import { SuggestedParams } from '../src/types/transactions/base';
import { encodeMsgpack } from '../src/encoding/encoding';
import generateAccount from '../src/account';
import { encodeUint64 } from '../src/encoding/uint64';

const env = typeof process !== 'undefined' ? process.env : {};
const server = env.DT_ALGOD_SERVER;

// MainNet objects with history.
const USDC = 31566704n;
const USDC_RESERVE =
  '2UEQTE5QDNXPI7M3TU44G6SYKLFWLPQO7EBZM7K7MHMQQMFI4QJPLHQFHM';
const XGOV = 3147789458n;
const XGOV_CREATOR =
  'I7OP7WFSK57IFDHJA6DM5TJC2IFY4M3XSBV4R4PVOV4YWF7K57BZFUVQ5E';
const NFD = 760937186n;

/** A round before the xGov app existed, after USDC was created. */
const PAST = 50_000_000n;

const sameBytes = (a?: Uint8Array, b?: Uint8Array) =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

describe('time travel against a live node', function liveSuite() {
  this.timeout(60_000);

  let c: DTAlgodClient;
  let latest: bigint;

  before(async function setup() {
    if (!server) this.skip();
    const url = new URL(server!);
    c = new DTAlgodClient(
      env.DT_ALGOD_TOKEN ?? '',
      `${url.protocol}//${url.hostname}`,
      url.port
    );
    const { genesisID } = await c.getTransactionParams().do();
    if (genesisID !== 'mainnet-v1.0') this.skip();
    latest = (await c.status().do()).lastRound;
  });

  it('supports time travel', async () => {
    assert.strictEqual(await c.supportsDT(), true);
  });

  it('reports its simulate limits', async () => {
    const l = await c.simulateLimits();
    assert.strictEqual(l.reported, true);
    assert.strictEqual(l.timeTravel, true);
    assert.ok(l.maxTxnGroups >= 1);
    assert.ok(l.maxExtraOpcodeBudget >= 320000);
    assert.ok(l.resourceLimitMultiplier >= 1);
  });

  describe('reads at a round', () => {
    it('reads an account at a past round', async () => {
      const r = await c
        .accountInformation(XGOV_CREATOR)
        .exclude('all')
        .round(PAST + 3_000_000n)
        .do();
      assert.strictEqual(r.round, PAST + 3_000_000n);
    });

    it('reads an account before it existed as empty', async () => {
      const r = await c
        .accountInformation(XGOV_CREATOR)
        .exclude('all')
        .round(1000)
        .do();
      assert.strictEqual(r.round, 1000n);
      assert.strictEqual(r.amount, 0n);
    });

    it('reads account assets and applications at a round', async () => {
      const holding = await c
        .accountAssetInformation(USDC_RESERVE, USDC)
        .round(PAST)
        .do();
      assert.strictEqual(holding.round, PAST);
      assert.ok(holding.assetHolding && holding.createdAsset);

      // These responses type round as a number (upstream generator config).
      const assets = await c
        .accountAssetsInformation(USDC_RESERVE)
        .round(PAST)
        .do();
      assert.strictEqual(BigInt(assets.round), PAST);
      assert.ok(assets.assetHoldings?.length);

      const at = latest - 10n;
      const apps = await c
        .accountApplicationsInformation(XGOV_CREATOR)
        .round(at)
        .do();
      assert.strictEqual(BigInt(apps.round), at);

      const app = await c
        .accountApplicationInformation(XGOV_CREATOR, XGOV)
        .round(at)
        .do();
      assert.strictEqual(app.round, at);
      assert.ok(app.createdApp, 'the creator sees the parameters');
    });

    it('reads the supply at a round', async () => {
      const r = await c.supply().round(PAST).do();
      assert.strictEqual(r.currentRound, PAST);
    });

    it('reads an asset and an application at a round', async () => {
      const asset = await c.getAssetByID(USDC).round(PAST).do();
      assert.strictEqual(asset.index, USDC);
      const app = await c
        .getApplicationByID(XGOV)
        .round(latest - 10n)
        .do();
      assert.strictEqual(app.id, XGOV);
    });

    it('marks an answer at a round with X-Algod-TT-Round', async () => {
      const { headers } = await c
        .getAssetByID(USDC)
        .round(PAST)
        .doWithHeaders();
      assert.strictEqual(headers['x-algod-tt-round'], PAST.toString());
    });

    it('answers 404 for an asset before its creation, marked with the round', async () => {
      await assert.rejects(
        c.getAssetByID(USDC).round(1000).do(),
        (err: {
          status?: number;
          response?: { headers?: Record<string, string> };
        }) =>
          !(err instanceof DTUnsupportedError) &&
          err.status === 404 &&
          err.response?.headers?.['x-algod-tt-round'] === '1000'
      );
    });

    it('rejects a round after the latest', async () => {
      await assert.rejects(
        c
          .accountInformation(XGOV_CREATOR)
          .exclude('all')
          .round(latest + 100_000n)
          .do()
      );
    });
  });

  describe('boxes', () => {
    it('lists box changes whose values match the boxes read at those rounds', async () => {
      const res = await c
        .getApplicationBoxesVersions(XGOV)
        .order('desc')
        .limit(3)
        .include('values')
        .do();
      assert.ok(res.versions.length > 0);
      const changes = res.versions.flatMap((v) =>
        v.boxes.filter((b) => !b.deleted).map((b) => ({ round: v.round, b }))
      );
      const boxes = await Promise.all(
        changes.map(({ round, b }) =>
          c.getApplicationBoxByName(XGOV, b.name).round(round).do()
        )
      );
      changes.forEach(({ round, b }, i) => {
        assert.strictEqual(boxes[i].round, round);
        assert.ok(sameBytes(boxes[i].value, b.value), `value at ${round}`);
      });
    });

    it('iterates box changes in order within the round bounds', async () => {
      const min = latest - 20_000n;
      let prev = 0n;
      for await (const v of c
        .getApplicationBoxesVersions(NFD)
        .minRound(min)
        .maxRound(latest)
        .limit(20)
        .iterate()) {
        assert.ok(v.round >= prev && v.round >= min && v.round <= latest);
        prev = v.round;
      }
    });

    it("lists one box's versions whose values match reads at those rounds", async () => {
      const page = await c
        .getApplicationBoxesVersions(XGOV)
        .order('desc')
        .limit(1)
        .do();
      const { name } = page.versions[0].boxes[0];
      const versions = [];
      for await (const v of c
        .getApplicationBoxVersions(XGOV, name)
        .include('values')
        .limit(5)
        .iterate())
        versions.push(v);
      assert.ok(versions.length > 0);
      const live = versions.slice(-3).filter((x) => !x.deleted);
      const boxes = await Promise.all(
        live.map((v) =>
          c.getApplicationBoxByName(XGOV, name).round(v.round).do()
        )
      );
      live.forEach((v, i) =>
        assert.ok(sameBytes(boxes[i].value, v.value), `value at ${v.round}`)
      );
    });

    it('pages through boxes at a round', async () => {
      const at = latest - 100n;
      const p1 = await c
        .getApplicationBoxes(XGOV)
        .round(at)
        .limit(3)
        .include('values')
        .do();
      assert.strictEqual(BigInt(p1.round!), at);
      assert.ok(p1.boxes.length > 0 && p1.boxes.every((b) => b.value));
      const p2 = await c
        .getApplicationBoxes(XGOV)
        .round(at)
        .limit(3)
        .next(p1.nextToken)
        .do();
      const names = new Set(
        [...p1.boxes, ...p2.boxes].map((b) =>
          Buffer.from(b.name).toString('base64')
        )
      );
      assert.strictEqual(
        names.size,
        p1.boxes.length + p2.boxes.length,
        'pages overlap'
      );
    });
  });

  describe('object versions', () => {
    it('lists asset and application versions', async () => {
      const asset = await c.getAssetVersions(USDC).do();
      assert.ok(asset.versions.length > 0);
      const app = await c.getApplicationVersions(XGOV).include('values').do();
      assert.ok(app.versions.length > 0);
    });

    it("lists account versions that match the account read at the version's round", async () => {
      const res = await c
        .accountVersions(XGOV_CREATOR)
        .exclude('all')
        .order('desc')
        .limit(5)
        .include('values')
        .do();
      const v = res.versions.find((x) => x.base?.account);
      assert.ok(v, 'a version with the base account');
      const acct = await c
        .accountInformation(XGOV_CREATOR)
        .exclude('all')
        .round(v.round)
        .do();
      assert.strictEqual(v.base!.account!.amount, acct.amount);
    });

    it('lists account asset and application versions', async () => {
      const asset = await c
        .accountAssetVersions(USDC_RESERVE, USDC)
        .order('desc')
        .limit(3)
        .include('values')
        .do();
      assert.ok(asset.versions.length > 0);
      const app = await c
        .accountApplicationVersions(XGOV_CREATOR, XGOV)
        .limit(3)
        .do();
      assert.ok(app.versions.length > 0);
    });
  });

  describe('query', () => {
    // #pragma version 10; global Round; itob; log; txn ApplicationArgs 0; log; int 1
    const PROGRAM = 'CjIGFrA2GgCwgQE=';
    const hi = new TextEncoder().encode('hi');
    let limits: QueryLimits;

    before(async function needsQuery() {
      if (!c) this.skip();
      const { query } = await c.simulateLimits();
      // Queries are optional (MaxAPIQueryCalls).
      if (!query) this.skip();
      limits = query!;
    });

    it('reports its query limits', () => {
      assert.ok(limits.maxCalls >= 1);
      assert.ok(limits.maxRounds >= 1);
      assert.ok(limits.maxCallBudget >= 700);
    });

    it('runs a program at several rounds', async () => {
      const res = await c
        .query({ program: PROGRAM, calls: [{ args: [hi] }, {}] })
        .rounds([0, PAST, PAST])
        .do();
      assert.strictEqual(res.rounds.length, 3);
      const [now, past, again] = res.rounds;
      assert.ok(now.round > PAST && now.round <= res.lastRound);
      assert.strictEqual(past.round, PAST);
      for (const r of res.rounds) {
        assert.strictEqual(r.error, undefined);
        assert.strictEqual(r.calls.length, 2);
        const [ok, failed] = r.calls;
        // Calls run in the block after the queried round.
        assert.ok(sameBytes(ok.logs[0], encodeUint64(r.round + 1n)));
        assert.ok(sameBytes(ok.logs[1], hi));
        assert.strictEqual(ok.error, undefined);
        assert.ok(ok.cost > 0);
        assert.match(failed.error!, /ApplicationArgs/);
        assert.strictEqual(failed.logs.length, 1);
      }
      assert.deepStrictEqual(again, past);
      // The default protocol is latest, not the round's own.
      assert.strictEqual(past.protocolOverride?.applied, true);
    });

    it("runs under the round's own protocol with protocol('round')", async () => {
      const res = await c
        .query({ program: PROGRAM, calls: [{ args: [hi] }] })
        .rounds([PAST])
        .protocol('round')
        .do();
      const [r] = res.rounds;
      assert.strictEqual(r.protocolOverride, undefined);
      assert.strictEqual(r.calls[0].error, undefined);
    });

    it('calls a deployed app', async () => {
      const res = await c
        .query({ appId: XGOV, calls: [{}] })
        .rounds([0, PAST])
        .do();
      assert.strictEqual(res.rounds.length, 2);
      for (const r of res.rounds) {
        assert.strictEqual(r.error, undefined);
        assert.strictEqual(r.calls.length, 1);
        assert.strictEqual(typeof r.calls[0].cost, 'number');
        assert.ok(Array.isArray(r.calls[0].logs));
      }
      // The app did not exist yet: the call fails, not the request.
      assert.strictEqual(typeof res.rounds[1].calls[0].error, 'string');
      const nfd = await c.query({ appId: NFD, calls: [{}] }).do();
      assert.strictEqual(nfd.rounds[0].calls.length, 1);
    });

    it("passes the node's rejections through as 400s", async () => {
      const rejected = async (call: Promise<unknown>, message: RegExp) =>
        assert.rejects(
          call,
          (err) =>
            !(err instanceof DTUnsupportedError) &&
            (err as { status?: number }).status === 400 &&
            message.test(
              (err as { response?: { text?: string } }).response?.text ?? ''
            )
        );
      await rejected(
        c
          .query({
            program: PROGRAM,
            calls: Array.from({ length: limits.maxCalls + 1 }, () => ({})),
          })
          .do(),
        /too many calls/
      );
      await rejected(
        c
          .query({ program: PROGRAM, calls: [{}] })
          .rounds([latest + 1000n])
          .do(),
        /after the latest round/
      );
    });
  });

  describe('simulate', () => {
    let fund: Transaction;
    let spend: Transaction;
    const group = (...txns: Transaction[]) =>
      new SimulateRequestTransactionGroup({
        txns: txns.map((txn) => new SignedTransaction({ txn })),
      });
    const request = () =>
      new DTSimulateRequest({
        txnGroups: [group(fund), group(spend)],
        allowEmptySignatures: true,
      });

    before(async () => {
      const sp = await c.getTransactionParams().do();
      // Valid from 600 rounds back, so the groups can run at recent rounds.
      const params: SuggestedParams = {
        ...sp,
        firstValid: latest - 600n,
        lastValid: latest + 300n,
      };
      const fresh = generateAccount().addr;
      fund = makePaymentTxnWithSuggestedParamsFromObject({
        sender: XGOV_CREATOR,
        receiver: fresh,
        amount: 1_000_000,
        suggestedParams: params,
      });
      spend = makePaymentTxnWithSuggestedParamsFromObject({
        sender: fresh,
        receiver: XGOV_CREATOR,
        amount: 100_000,
        suggestedParams: params,
      });
    });

    it('runs groups in order, each seeing the ones before it', async () => {
      const r = await c.simulateTransactions(request()).do();
      assert.strictEqual(r.txnGroups.length, 2);
      assert.deepStrictEqual(
        r.txnGroups.map((g) => g.failureMessage),
        [undefined, undefined]
      );
    });

    it('runs parallel groups alone against the start state', async () => {
      const r = await c.simulateTransactions(request()).parallelGroups().do();
      assert.strictEqual(r.txnGroups[0].failureMessage, undefined);
      assert.match(r.txnGroups[1].failureMessage ?? '', /overspend/);
    });

    it('simulates at several rounds, one result per round', async () => {
      const rounds = [latest - 10n, latest - 500n, 0n];
      const r = await c.simulateTransactions(request()).rounds(rounds).do();
      assert.strictEqual(r.roundResults!.length, 3);
      for (const rr of r.roundResults!) {
        assert.strictEqual(rr.error, undefined);
        assert.ok(rr.txnGroups.every((g) => !g.failureMessage));
      }
      assert.strictEqual(r.roundResults![0].lastRound, latest - 10n);
      assert.strictEqual(r.roundResults![1].lastRound, latest - 500n);
    });

    it('reports a round outside the validity window in that round only', async () => {
      const r = await c.simulateTransactions(request()).rounds([PAST, 0n]).do();
      const [past, now] = r.roundResults!;
      assert.strictEqual(past.lastRound, PAST);
      assert.match(
        past.error ?? past.txnGroups[0].failureMessage ?? '',
        /txn dead/
      );
      assert.ok(now.txnGroups.every((g) => !g.failureMessage));
    });

    it('simulates in the distant past with transactions valid then', async () => {
      const sp = await c.getTransactionParams().do();
      const params: SuggestedParams = {
        ...sp,
        firstValid: PAST - 10n,
        lastValid: PAST + 900n,
      };
      const pay = (sender: string) =>
        makePaymentTxnWithSuggestedParamsFromObject({
          sender,
          receiver: generateAccount().addr,
          amount: 1_000_000,
          suggestedParams: params,
        });
      const r = await c
        .simulateTransactions(
          new DTSimulateRequest({
            // The xGov creator did not exist yet; the USDC reserve was rekeyed.
            txnGroups: [group(pay(XGOV_CREATOR)), group(pay(USDC_RESERVE))],
            allowEmptySignatures: true,
            fixSigners: true,
          })
        )
        .rounds([PAST])
        .do();
      const [rr] = r.roundResults!;
      assert.strictEqual(rr.lastRound, PAST);
      assert.match(rr.txnGroups[0].failureMessage ?? '', /overspend/);
      assert.strictEqual(rr.txnGroups[1].failureMessage, undefined);
    });

    it('takes several groups of raw transactions', async () => {
      const raw = (txn: Transaction) =>
        encodeMsgpack(new SignedTransaction({ txn }));
      const r = await c
        .simulateRawTransactions([[raw(fund)], [raw(spend)]])
        .do();
      // Unsigned, and without allowEmptySignatures, so both fail.
      assert.strictEqual(r.txnGroups.length, 2);
      assert.ok(r.txnGroups.every((g) => g.failureMessage));
    });
  });

  describe('versions rounds and keys', () => {
    /** A mainnet app whose global state changes every few rounds. */
    const ORE = 1284326447n;

    it('lists versions as of rounds', async () => {
      const res = await c
        .getAssetVersions(USDC)
        .rounds([60_000_000, 1000])
        .do();
      assert.deepStrictEqual(
        res.versions.map((v) => [v.round, v.deleted, v.changedRound]),
        [
          [1000n, true, undefined],
          [60_000_000n, false, 8_874_561n],
        ]
      );
    });

    it('lists the global state keys each version changed', async () => {
      const res = await c
        .getApplicationVersions(ORE)
        .order('desc')
        .limit(2)
        .include('keys')
        .do();
      assert.strictEqual(res.versions.length, 2);
      for (const v of res.versions) {
        assert.ok(Array.isArray(v.changedKeys), `${v.round}`);
      }
      const names = res.versions.flatMap((v) =>
        v.changedKeys!.map((k) => new TextDecoder().decode(k))
      );
      assert.ok(names.includes('total_effort'), names.join(','));
    });
  });

  describe('holders', () => {
    it('lists the holders of an asset, two pages at one round', async function holders() {
      // The holders index is optional.
      if (!(await c.supportsAssetHolders())) this.skip();
      const pages = [];
      for await (const page of c.getAssetHolders(USDC).limit(2).pages()) {
        pages.push(page);
        if (pages.length === 2) break;
      }
      assert.strictEqual(pages.length, 2);
      assert.strictEqual(pages[1].round, pages[0].round);
      const all = pages.flatMap((p) => p.holders);
      assert.ok(all.length >= 1 && all.length <= 4);
      for (const h of all) {
        assert.strictEqual(typeof h.address, 'string');
        assert.strictEqual(typeof h.amount, 'bigint');
      }
      // In address order, across pages.
      const addresses = all.map((h) => h.address);
      assert.deepStrictEqual([...addresses].sort(), addresses);
    });
  });

  describe('versions filters', () => {
    const ORE = 1284326447n;
    const XGOV_APP = XGOV;

    it('lists the versions of one global state key', async () => {
      const versions = [];
      for await (const v of c
        .getApplicationVersions(ORE)
        .key(new TextEncoder().encode('total_effort'))
        .order('desc')
        .limit(2)
        .iterate()) {
        versions.push(v);
        if (versions.length === 2) break;
      }
      assert.strictEqual(versions.length, 2);
      assert.ok(versions[0].round > versions[1].round);
      for (const v of versions) {
        assert.strictEqual(v.deleted, false);
        assert.strictEqual(v.keyValue?.type, 2);
      }
      assert.notStrictEqual(
        versions[0].keyValue?.uint,
        versions[1].keyValue?.uint
      );
    });

    it('lists the changes of the boxes under a prefix', async () => {
      const newest = await c
        .getApplicationBoxesVersions(XGOV_APP)
        .order('desc')
        .limit(1)
        .do();
      const first = newest.versions[0].boxes[0].name;
      const p = first.slice(0, 1);
      const versions = [];
      for await (const v of c
        .getApplicationBoxesVersions(XGOV_APP)
        .prefix(p)
        .order('desc')
        .limit(2)
        .iterate()) {
        versions.push(v);
        if (versions.length === 2) break;
      }
      assert.ok(versions.length >= 1);
      assert.strictEqual(versions[0].round, newest.versions[0].round);
      for (const v of versions) {
        assert.ok(v.boxes.length >= 1);
        for (const b of v.boxes) assert.strictEqual(b.name[0], p[0]);
      }
    });
  });

  describe('effort', () => {
    it('returns the headers of a versions page, with any effort well-formed', async () => {
      const { data, headers } = await c
        .getAssetVersions(USDC)
        .order('desc')
        .limit(1)
        .doWithHeaders();
      assert.ok(data.versions.length <= 1);
      assert.ok(Object.keys(headers).every((k) => k === k.toLowerCase()));
      const e = effortOf(headers);
      // Off unless the node sets EnableEffortHeader.
      if (headers[EFFORT_HEADER] === undefined) {
        assert.strictEqual(e, undefined);
      } else {
        assert.ok(e && e.lookups >= 1 && e.responseBytes >= 1);
      }
    });
  });
});
