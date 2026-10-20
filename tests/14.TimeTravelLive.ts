/* eslint-env mocha */
/**
 * Live checks of TimeTravelAlgodClient against a real MainNet time-travel node
 * (`EnableTimeTravel: true`). Skipped unless DT_ALGOD_SERVER is set:
 *
 *   DT_ALGOD_SERVER=http://10.114.0.27:4000 npx mocha --import=tsx tests/14.TimeTravelLive.ts
 *
 * DT_ALGOD_TOKEN sets the API token, if the node needs one.
 */
import assert from 'assert';
import {
  TimeTravelAlgodClient,
  TimeTravelSimulateRequest,
} from '../src/client/v2/algod/timeTravel/index';
import { SimulateRequestTransactionGroup } from '../src/client/v2/algod/models/types';
import { makePaymentTxnWithSuggestedParamsFromObject } from '../src/makeTxn';
import { SignedTransaction } from '../src/signedTransaction';
import { Transaction } from '../src/transaction';
import { SuggestedParams } from '../src/types/transactions/base';
import { encodeMsgpack } from '../src/encoding/encoding';
import generateAccount from '../src/account';

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

  let c: TimeTravelAlgodClient;
  let latest: bigint;

  before(async function setup() {
    if (!server) this.skip();
    const url = new URL(server!);
    c = new TimeTravelAlgodClient(
      env.DT_ALGOD_TOKEN ?? '',
      `${url.protocol}//${url.hostname}`,
      url.port
    );
    const { genesisID } = await c.getTransactionParams().do();
    if (genesisID !== 'mainnet-v1.0') this.skip();
    latest = (await c.status().do()).lastRound;
  });

  it('supports time travel', async () => {
    assert.strictEqual(await c.supportsTimeTravel(), true);
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

    it('answers 404 for an asset before its creation', async () => {
      await assert.rejects(c.getAssetByID(USDC).round(1000).do(), {
        status: 404,
      });
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

  describe('simulate', () => {
    let fund: Transaction;
    let spend: Transaction;
    const group = (...txns: Transaction[]) =>
      new SimulateRequestTransactionGroup({
        txns: txns.map((txn) => new SignedTransaction({ txn })),
      });
    const request = () =>
      new TimeTravelSimulateRequest({
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
          new TimeTravelSimulateRequest({
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
});
