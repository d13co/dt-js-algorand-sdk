/* eslint-env mocha */
import assert from 'assert';
import {
  BaseHTTPClient,
  BaseHTTPClientResponse,
} from '../src/client/baseHTTPClient';
import { HTTPClient } from '../src/client/client';
import { URLTokenBaseHTTPClient } from '../src/client/urlTokenBaseHTTPClient';
import {
  DEFAULT_RETRY_POLICY,
  RetryContext,
  RetryWait,
  RetryingHTTPClient,
  callWithRetry,
  formatRetryWait,
  isNonIdempotentRequest,
  isRetryingClient,
  isTimeLimitedRequest,
  retryDecision,
  retryPolicy,
  sleepUnlessAborted,
  withRetry,
} from '../src/client/retry';
import * as algosdk from '../src/index';

/** An error as URLTokenBaseHTTPClient throws it: status only on `response`. */
function httpError(
  status: number,
  {
    message,
    headers = {},
    inBodyOnly = false,
  }: {
    message?: string;
    headers?: Record<string, string>;
    inBodyOnly?: boolean;
  } = {}
) {
  const body = message
    ? new TextEncoder().encode(JSON.stringify({ message }))
    : new Uint8Array();
  const text = `Network request error. Received status ${status}${
    message && !inBodyOnly ? `: ${message}` : ''
  }`;
  return Object.assign(new Error(text), {
    response: { status, headers, body },
  });
}

/** Node's fetch: TypeError('fetch failed') with the code on `cause`. */
function fetchFailed(code?: string) {
  const err = new TypeError('fetch failed');
  if (code) {
    (err as { cause?: unknown }).cause = Object.assign(new Error(code), {
      code,
    });
  }
  return err;
}

/** Waits until `done()`, a millisecond at a time. */
async function tick(done: () => boolean) {
  for (let i = 0; i < 1000 && !done(); i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1);
    });
  }
}

const busy = () => httpError(503, { message: 'the node is busy' });

function ctx(
  tries: number,
  method: RetryContext['method'] = 'get',
  path = '/v2/status'
): RetryContext {
  return { method, path, tries };
}

const ok: BaseHTTPClientResponse = {
  body: new TextEncoder().encode('{}'),
  status: 200,
  headers: {},
};

/** A BaseHTTPClient that throws or answers from a list, one per request. */
class ScriptedClient implements BaseHTTPClient {
  public calls: { method: string; path: string }[] = [];

  private script: (unknown | BaseHTTPClientResponse)[];

  constructor(script: (unknown | BaseHTTPClientResponse)[]) {
    this.script = script;
  }

  private next(method: string, path: string) {
    this.calls.push({ method, path });
    const step = this.script.shift();
    if (step === undefined) return Promise.resolve(ok);
    if (step instanceof Error || (step as { response?: unknown }).response) {
      return Promise.reject(step);
    }
    return Promise.resolve(step as BaseHTTPClientResponse);
  }

  get(relativePath: string) {
    return this.next('get', relativePath);
  }

  post(relativePath: string) {
    return this.next('post', relativePath);
  }

  delete(relativePath: string) {
    return this.next('delete', relativePath);
  }
}

/** A sleep that records the waits and doesn't wait. */
function recordingSleep() {
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  return { waits, sleep };
}

describe('Retry policy', () => {
  describe('retryDecision', () => {
    it('never retries an aborted request', () => {
      const controller = new AbortController();
      controller.abort();
      const d = retryDecision(busy(), { ...ctx(1), signal: controller.signal });
      assert.deepStrictEqual(d, { retry: false, reason: 'aborted' });
    });

    it('waits at least 1 s for a busy 503 without Retry-After', () => {
      assert.deepStrictEqual(retryDecision(busy(), ctx(1)), {
        retry: true,
        reason: 'node-busy',
        delayMs: 1000,
      });
    });

    it('finds the busy message in a body the error message leaves out', () => {
      const err = httpError(503, {
        message: 'the node is busy',
        inBodyOnly: true,
      });
      assert.strictEqual(retryDecision(err, ctx(1)).reason, 'node-busy');
    });

    it('treats a 429 like a busy node', () => {
      assert.deepStrictEqual(retryDecision(httpError(429), ctx(1)), {
        retry: true,
        reason: 'rate-limited',
        delayMs: 1000,
      });
      const withHeader = httpError(429, { headers: { 'retry-after': '1' } });
      assert.deepStrictEqual(retryDecision(withHeader, ctx(1)), {
        retry: true,
        reason: 'rate-limited',
        delayMs: 1000,
        retryAfterMs: 1000,
      });
      assert.strictEqual(algosdk.isTooManyRequests(withHeader), true);
      assert.strictEqual(algosdk.isNodeBusy(withHeader), false);
    });

    it('waits the longer of the backoff and Retry-After', () => {
      const ra = (s: string) =>
        httpError(503, {
          message: 'the node is busy',
          headers: { 'Retry-After': s },
        });
      assert.strictEqual(retryDecision(ra('3'), ctx(1)).retry && 3000, 3000);
      const d = retryDecision(ra('1'), ctx(3));
      assert.ok(d.retry);
      assert.strictEqual(d.delayMs, 4000);
    });

    it('honours Retry-After up to 30 s and gives up above it', () => {
      const ra = (s: string) =>
        httpError(429, { headers: { 'Retry-After': s } });
      const at30 = retryDecision(ra('30'), ctx(1));
      assert.ok(at30.retry);
      assert.strictEqual(at30.delayMs, 30_000);
      assert.deepStrictEqual(retryDecision(ra('31'), ctx(1)), {
        retry: false,
        reason: 'retry-after-too-long',
        retryAfterMs: 31_000,
      });
      const longer = retryDecision(ra('31'), ctx(1), {
        maxRetryAfterMs: 60_000,
      });
      assert.ok(longer.retry);
      assert.strictEqual(longer.delayMs, 31_000);
    });

    it('reads Retry-After only on 429 and 503', () => {
      const err = httpError(500, { headers: { 'Retry-After': '120' } });
      assert.deepStrictEqual(retryDecision(err, ctx(1)), {
        retry: true,
        reason: 'server-error',
        delayMs: 0,
      });
    });

    it('backs off 0, 2, 4, 8 s, capped at 10 s', () => {
      const delays = [1, 2, 3, 4, 5, 6].map((tries) => {
        const d = retryDecision(httpError(502), ctx(tries), { maxTries: 10 });
        return d.retry ? d.delayMs : -1;
      });
      assert.deepStrictEqual(delays, [0, 2000, 4000, 8000, 10_000, 10_000]);
    });

    it('gives up after maxTries', () => {
      assert.deepStrictEqual(retryDecision(busy(), ctx(5)), {
        retry: false,
        reason: 'max-tries',
      });
      assert.strictEqual(
        retryDecision(busy(), ctx(1), { maxTries: 1 }).reason,
        'max-tries'
      );
      assert.strictEqual(
        retryDecision(busy(), ctx(1), false).reason,
        'max-tries'
      );
    });

    it('never retries history the node cannot serve, on any try', () => {
      for (const message of [
        'the box index is incomplete',
        'the asset holders index is not complete',
        'the time travel history is not served',
      ]) {
        for (const tries of [1, 5]) {
          assert.deepStrictEqual(
            retryDecision(httpError(503, { message }), ctx(tries)),
            { retry: false, reason: 'history-unavailable' }
          );
        }
      }
    });

    it('never retries a 504 from a request under the time limit', () => {
      for (const [method, path] of [
        ['post', '/v2/query'],
        ['post', '/v2/transactions/simulate'],
        ['get', '/v2/deltas/123'],
        ['get', '/v2/applications/1/boxes/versions'],
        ['get', '/v2/assets/31566704/holders'],
      ] as const) {
        assert.ok(isTimeLimitedRequest(method, path), path);
        assert.strictEqual(
          retryDecision(httpError(504), ctx(1, method, path)).reason,
          'time-limit'
        );
      }
      assert.strictEqual(
        retryDecision(httpError(504), ctx(1, 'get', '/v2/status')).reason,
        'server-error'
      );
      // algod's own version endpoint is no listing
      assert.ok(!isTimeLimitedRequest('get', '/versions'));
      assert.strictEqual(
        retryDecision(httpError(504), ctx(1, 'get', '/versions')).reason,
        'server-error'
      );
      assert.strictEqual(
        retryDecision(httpError(503), ctx(1, 'post', '/v2/query')).reason,
        'server-error'
      );
    });

    it('does not retry other statuses, 413 included', () => {
      for (const status of [400, 401, 404, 413]) {
        assert.strictEqual(
          retryDecision(httpError(status), ctx(1)).reason,
          'not-retryable'
        );
      }
    });

    it('retries network errors, refused connections after at least 1 s', () => {
      assert.deepStrictEqual(
        retryDecision(fetchFailed('ECONNREFUSED'), ctx(1)),
        {
          retry: true,
          reason: 'network',
          delayMs: 1000,
        }
      );
      assert.deepStrictEqual(retryDecision(fetchFailed('ECONNRESET'), ctx(1)), {
        retry: true,
        reason: 'network',
        delayMs: 0,
      });
      assert.deepStrictEqual(
        retryDecision(new TypeError('Failed to fetch'), ctx(1)),
        { retry: true, reason: 'network', delayMs: 1000 }
      );
      const nodeStyle = Object.assign(new Error('connect'), {
        code: 'ETIMEDOUT',
      });
      assert.strictEqual(retryDecision(nodeStyle, ctx(1)).reason, 'network');
    });

    it('does not retry other errors', () => {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      for (const err of [
        new TypeError("Cannot read properties of undefined (reading 'x')"),
        fetchFailed('CERT_HAS_EXPIRED'),
        abort,
        new Error('boom'),
        undefined,
        'a string',
      ]) {
        assert.strictEqual(
          retryDecision(err, ctx(1)).reason,
          'not-retryable',
          String(err)
        );
      }
    });

    it('retries a transaction submit only when the node surely did not take it', () => {
      for (const path of ['/v2/transactions', '/v2/transactions/async']) {
        assert.ok(isNonIdempotentRequest('post', path));
        const at = (err: unknown) =>
          retryDecision(err, ctx(1, 'post', path)).reason;
        assert.strictEqual(at(httpError(429)), 'rate-limited');
        assert.strictEqual(at(busy()), 'node-busy');
        assert.strictEqual(at(fetchFailed('ECONNREFUSED')), 'network');
        assert.strictEqual(at(fetchFailed('ENOTFOUND')), 'network');
        assert.strictEqual(at(fetchFailed('ECONNRESET')), 'not-idempotent');
        assert.strictEqual(
          at(new TypeError('Failed to fetch')),
          'not-idempotent'
        );
        assert.strictEqual(at(httpError(502)), 'not-idempotent');
        assert.strictEqual(at(httpError(504)), 'not-idempotent');
      }
      assert.ok(!isNonIdempotentRequest('post', '/v2/transactions/simulate'));
      assert.ok(!isNonIdempotentRequest('get', '/v2/transactions/params'));
    });

    it('reads Retry-After as an HTTP date, and treats 0 as none', () => {
      const at = (value: string) =>
        retryDecision(
          httpError(429, { headers: { 'Retry-After': value } }),
          ctx(1)
        );
      const future = new Date(Date.now() + 3_000).toUTCString();
      const d = at(future);
      assert.ok(d.retry);
      assert.ok(d.delayMs >= 1000 && d.delayMs <= 4000, String(d.delayMs));
      const past = at(new Date(Date.now() - 60_000).toUTCString());
      assert.ok(past.retry);
      assert.strictEqual(past.delayMs, 1000);
      const zero = at('0');
      assert.ok(zero.retry);
      assert.strictEqual(zero.delayMs, 1000);
    });

    it('treats a NaN or negative backoff as 0, keeping the other floors', () => {
      const ra = httpError(429, { headers: { 'Retry-After': '5' } });
      const nan = retryDecision(ra, ctx(2), { backoffMs: () => NaN });
      assert.ok(nan.retry);
      assert.strictEqual(nan.delayMs, 5000);
      const negative = retryDecision(httpError(502), ctx(2), {
        backoffMs: () => -50,
      });
      assert.ok(negative.retry);
      assert.strictEqual(negative.delayMs, 0);
      assert.strictEqual(retryPolicy({ maxTries: NaN }).maxTries, 5);
      assert.strictEqual(retryPolicy({ maxTries: 0 }).maxTries, 1);
      const nans = retryPolicy({
        maxBackoffMs: NaN,
        maxRetryAfterMs: NaN,
        busyMinDelayMs: NaN,
      });
      assert.strictEqual(nans.maxBackoffMs, 10_000);
      assert.strictEqual(nans.maxRetryAfterMs, 30_000);
      assert.strictEqual(nans.busyMinDelayMs, 1000);
      assert.strictEqual(retryPolicy({ busyMinDelayMs: -5 }).busyMinDelayMs, 0);
      assert.strictEqual(
        retryPolicy({ maxRetryAfterMs: Infinity }).maxRetryAfterMs,
        Infinity
      );
      const busyNaN = retryDecision(httpError(429), ctx(1), {
        busyMinDelayMs: NaN,
      });
      assert.ok(busyNaN.retry);
      assert.strictEqual(busyNaN.delayMs, 1000);
    });

    it('retries a submit whose connection was never made', () => {
      for (const code of [
        'UND_ERR_CONNECT_TIMEOUT',
        'ENETUNREACH',
        'EHOSTUNREACH',
      ]) {
        assert.strictEqual(
          retryDecision(fetchFailed(code), ctx(1, 'post', '/v2/transactions'))
            .reason,
          'network',
          code
        );
      }
    });

    it('lets decide override a decision', () => {
      const seen: unknown[] = [];
      const d = retryDecision(httpError(404), ctx(2), {
        decide: (err, c, def) => {
          seen.push(def.reason, c.tries);
          return { retry: true, reason: 'server-error', delayMs: 5 };
        },
      });
      assert.deepStrictEqual(seen, ['not-retryable', 2]);
      assert.deepStrictEqual(d, {
        retry: true,
        reason: 'server-error',
        delayMs: 5,
      });
    });
  });

  describe('retryPolicy', () => {
    it('merges with the defaults, skipping undefined', () => {
      const p = retryPolicy({ maxTries: 3, maxBackoffMs: undefined });
      assert.strictEqual(p.maxTries, 3);
      assert.strictEqual(p.maxBackoffMs, DEFAULT_RETRY_POLICY.maxBackoffMs);
      assert.deepStrictEqual(
        retryPolicy({ retryStatuses: [503] }).retryStatuses,
        [503]
      );
      assert.strictEqual(retryPolicy(false).maxTries, 1);
      assert.strictEqual(retryPolicy().maxRetryAfterMs, 30_000);
      assert.ok(Object.isFrozen(DEFAULT_RETRY_POLICY));
    });
  });

  describe('error helpers on BaseHTTPClient errors', () => {
    it('read the status from response and the message from the body', () => {
      const err = httpError(503, {
        message: 'the time travel history is not served',
        inBodyOnly: true,
      });
      assert.strictEqual(algosdk.isHistoryUnavailable(err), true);
      assert.strictEqual(algosdk.isTimeLimitExceeded(httpError(504)), true);
      assert.strictEqual(
        algosdk.retryAfterSeconds(
          httpError(429, { headers: { 'Retry-After': '2' } })
        ),
        2
      );
    });

    it('isNetworkError: codes, fetch failures, not aborts or HTTP errors', () => {
      assert.strictEqual(
        algosdk.isNetworkError(fetchFailed('ECONNRESET')),
        true
      );
      assert.strictEqual(
        algosdk.isNetworkError(fetchFailed('UND_ERR_SOCKET')),
        true
      );
      assert.strictEqual(
        algosdk.isNetworkError(
          new TypeError('NetworkError when attempting to fetch resource.')
        ),
        true
      );
      assert.strictEqual(
        algosdk.isNetworkError(new TypeError('Load failed')),
        true
      );
      assert.strictEqual(
        algosdk.isNetworkError(new TypeError('Network request failed')),
        true
      );
      assert.strictEqual(
        algosdk.isNetworkError(new TypeError('x is undefined')),
        false
      );
      assert.strictEqual(algosdk.isNetworkError(httpError(502)), false);
      const timeout = new Error('timed out');
      timeout.name = 'TimeoutError';
      assert.strictEqual(algosdk.isNetworkError(timeout), false);
      assert.strictEqual(
        algosdk.isNetworkError(fetchFailed('ECONNRESET'), ['ECONNREFUSED']),
        false
      );
    });
  });

  describe('callWithRetry and withRetry', () => {
    it('retries until the request succeeds, telling onWait each time', async () => {
      const client = new ScriptedClient([
        httpError(429, { headers: { 'Retry-After': '1' } }),
        busy(),
        httpError(502),
      ]);
      const { waits, sleep } = recordingSleep();
      const seen: RetryWait[] = [];
      const retrying = withRetry(client, {
        sleep,
        onWait: (w) => seen.push(w),
      });
      const res = await retrying.get('/v2/status');
      assert.strictEqual(res, ok);
      assert.strictEqual(client.calls.length, 4);
      assert.deepStrictEqual(waits, [1000, 2000, 4000]);
      assert.deepStrictEqual(
        seen.map((w) => [w.reason, w.retry, w.maxRetries, w.status, w.delayMs]),
        [
          ['rate-limited', 1, 4, 429, 1000],
          ['node-busy', 2, 4, 503, 2000],
          ['server-error', 3, 4, 502, 4000],
        ]
      );
      assert.strictEqual(seen[0].retryAfterMs, 1000);
      assert.strictEqual(seen[1].retryAfterMs, undefined);
      assert.strictEqual(seen[0].method, 'get');
      assert.strictEqual(seen[0].path, '/v2/status');
      assert.strictEqual(
        formatRetryWait(seen[0]),
        'The node is rate limiting requests: retrying in 1 s (retry 1 of 4)'
      );
      assert.strictEqual(
        formatRetryWait({ ...seen[2], delayMs: 0 }),
        'The node answered 502: retrying now (retry 3 of 4)'
      );
    });

    it('throws the last error itself when it gives up', async () => {
      const last = busy();
      const client = new ScriptedClient([busy(), last]);
      const { sleep } = recordingSleep();
      await assert.rejects(
        withRetry(client, { sleep, maxTries: 2 }).get('/v2/status'),
        (err) => err === last
      );
      assert.strictEqual(client.calls.length, 2);
    });

    it('does not retry a status it must not', async () => {
      const notFound = httpError(404);
      const client = new ScriptedClient([notFound]);
      await assert.rejects(
        withRetry(client).get('/v2/accounts/x'),
        (err) => err === notFound
      );
      assert.strictEqual(client.calls.length, 1);
    });

    it('works under HTTPClient, which reads the error after the retries', async () => {
      const client = new ScriptedClient([busy()]);
      const { sleep } = recordingSleep();
      const http = new HTTPClient(withRetry(client, { sleep }));
      const res = await http.get({ relativePath: '/health' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(client.calls.length, 2);
    });

    it('works as the client of Algodv2 and DTAlgodClient, as documented', async () => {
      const client = new ScriptedClient([busy(), busy()]);
      const { sleep } = recordingSleep();
      const http = withRetry(client, { sleep });
      const algod = new algosdk.Algodv2(http, '');
      await algod.healthCheck().do();
      const dt = new algosdk.DTAlgodClient(http, '');
      await dt.healthCheck().do();
      assert.deepStrictEqual(
        client.calls.map((c) => c.path),
        // two busy answers and a retry each for Algodv2, then one for DTAlgodClient
        ['/health', '/health', '/health', '/health']
      );
    });

    it('ignores an onWait that throws or rejects', async () => {
      const client = new ScriptedClient([busy(), busy()]);
      const { sleep } = recordingSleep();
      let calls = 0;
      const res = await withRetry(client, {
        sleep,
        onWait: () => {
          calls += 1;
          if (calls === 1) throw new Error('broken listener');
          return Promise.reject(new Error('broken async listener')) as never;
        },
      }).get('/v2/status');
      assert.strictEqual(res, ok);
      assert.strictEqual(calls, 2);
    });

    it('lists the waits in progress, per request', async () => {
      const client = new ScriptedClient([busy(), httpError(429)]);
      const release: (() => void)[] = [];
      const retrying = new RetryingHTTPClient(client, {
        sleep: () =>
          new Promise<void>((resolve) => {
            release.push(resolve);
          }),
        busyMinDelayMs: 1000,
      });
      const a = retrying.get('/v2/status');
      const b = retrying.post('/v2/query', new Uint8Array());
      await tick(() => release.length === 2);
      assert.strictEqual(retrying.waits.length, 2);
      const latest = retrying.waiting!;
      assert.ok(retrying.waits.every((w) => w.until <= latest.until));
      release.forEach((r) => r());
      await Promise.all([a, b]);
      assert.strictEqual(retrying.waits.length, 0);
      assert.strictEqual(retrying.waiting, undefined);
    });

    it('stops waiting when the request is aborted', async () => {
      const client = new ScriptedClient([busy(), busy()]);
      const controller = new AbortController();
      const started = Date.now();
      const pending = withRetry(client, { busyMinDelayMs: 5000 }).get(
        '/v2/status',
        undefined,
        undefined,
        { signal: controller.signal }
      );
      setTimeout(() => controller.abort(new Error('stop')), 10);
      await assert.rejects(pending, /stop/);
      assert.ok(Date.now() - started < 2000);
      assert.strictEqual(client.calls.length, 1);
    });

    it('sends nothing for an already aborted request', async () => {
      const client = new ScriptedClient([]);
      const controller = new AbortController();
      controller.abort(new Error('already'));
      await assert.rejects(
        withRetry(client).get('/v2/status', undefined, undefined, {
          signal: controller.signal,
        }),
        /already/
      );
      assert.strictEqual(client.calls.length, 0);
    });

    it('stops after maxTries even when decide says retry', async () => {
      const client = new ScriptedClient([busy(), busy(), busy(), busy()]);
      const { sleep } = recordingSleep();
      await assert.rejects(
        withRetry(client, {
          sleep,
          maxTries: 3,
          decide: () => ({ retry: true, reason: 'server-error', delayMs: NaN }),
        }).get('/v2/status')
      );
      assert.strictEqual(client.calls.length, 3);
    });

    it('shows the wait in waiting from inside onWait, frozen', async () => {
      const client = new ScriptedClient([busy()]);
      const { sleep } = recordingSleep();
      let inside: RetryWait | undefined;
      let frozen = false;
      const retrying = new RetryingHTTPClient(client, {
        sleep,
        onWait: (w) => {
          inside = retrying.waiting;
          frozen = Object.isFrozen(w);
        },
      });
      await retrying.get('/v2/status');
      assert.ok(inside);
      assert.strictEqual(inside!.reason, 'node-busy');
      assert.ok(frozen);
      assert.strictEqual(retrying.waiting, undefined);
    });

    it('takes a signal without addEventListener', async () => {
      const client = new ScriptedClient([busy()]);
      const signal = { aborted: false } as AbortSignal;
      const res = await withRetry(client, { busyMinDelayMs: 5 }).get(
        '/v2/status',
        undefined,
        undefined,
        { signal }
      );
      assert.strictEqual(res, ok);
      await sleepUnlessAborted(1, signal);
    });

    it('formats every reason', () => {
      const base = {
        delayMs: 2500,
        until: 0,
        retry: 1,
        maxRetries: 4,
        method: 'get' as const,
        path: '/v2/status',
        error: undefined,
      };
      assert.strictEqual(
        formatRetryWait({ ...base, reason: 'node-busy', status: 503 }),
        'The node is busy: retrying in 3 s (retry 1 of 4)'
      );
      assert.strictEqual(
        formatRetryWait({ ...base, reason: 'server-error' }),
        'The node answered an error: retrying in 3 s (retry 1 of 4)'
      );
      assert.strictEqual(
        formatRetryWait({ ...base, reason: 'network' }),
        'Could not reach the node: retrying in 3 s (retry 1 of 4)'
      );
      // a reason from a decide written in plain JS
      assert.strictEqual(
        formatRetryWait({ ...base, reason: 'teapot' as never }),
        'The request failed: retrying in 3 s (retry 1 of 4)'
      );
    });

    it('does not wrap a retrying client twice', () => {
      const once = withRetry(new ScriptedClient([]));
      assert.ok(isRetryingClient(once));
      assert.strictEqual(withRetry(once, { maxTries: 9 }), once);
      assert.ok(!isRetryingClient(new ScriptedClient([])));
      const marked = Object.assign(new ScriptedClient([]), {
        [Symbol.for('dt-algosdk.retrying-client')]: true,
      });
      assert.strictEqual(withRetry(marked), marked);
    });

    it('retries a connection to a closed port as a network error', async () => {
      const seen: RetryWait[] = [];
      const { sleep } = recordingSleep();
      const client = withRetry(
        new URLTokenBaseHTTPClient({}, 'http://127.0.0.1', 59999),
        { sleep, maxTries: 2, onWait: (w) => seen.push(w) }
      );
      await assert.rejects(client.get('/v2/status'));
      assert.deepStrictEqual(
        seen.map((w) => w.reason),
        ['network']
      );
    });

    it('sleepUnlessAborted rejects with the reason of an aborted signal', async () => {
      const controller = new AbortController();
      controller.abort(new Error('gone'));
      await assert.rejects(sleepUnlessAborted(10, controller.signal), /gone/);
      await sleepUnlessAborted(1);
    });

    it('callWithRetry passes the request to the decisions', async () => {
      const seen: RetryContext[] = [];
      await assert.rejects(
        callWithRetry(
          () => Promise.reject(httpError(504)),
          { method: 'post', path: '/v2/query' },
          {
            decide: (_err, c, def) => {
              seen.push(c);
              return def;
            },
          }
        )
      );
      assert.deepStrictEqual(seen, [
        { method: 'post', path: '/v2/query', tries: 1 },
      ]);
    });
  });
});
