import {
  BaseHTTPClient,
  BaseHTTPClientResponse,
  Query,
} from './baseHTTPClient.js';
import {
  DEFAULT_NETWORK_ERROR_CODES,
  describe,
  isHistoryUnavailable,
  isNetworkError,
  isNodeBusy,
  networkErrorCode,
  retryAfterSeconds,
} from './v2/algod/dt/errors.js';

/** Why a failed request is retried. */
export type RetryWaitReason =
  | 'rate-limited'
  | 'node-busy'
  | 'server-error'
  | 'network';

/** Why a failed request is retried, or why it is not. */
export type RetryReason =
  | RetryWaitReason
  | 'aborted'
  | 'not-retryable'
  | 'history-unavailable'
  | 'time-limit'
  | 'not-idempotent'
  | 'max-tries'
  | 'retry-after-too-long';

/** The request a retry decision is about. */
export interface RetryRequest {
  method: 'get' | 'post' | 'delete';
  /** The path without the query, e.g. `/v2/query`. */
  path: string;
  /** The request's abort signal: an aborted request is never retried. */
  signal?: AbortSignal;
}

/** A request that failed, after `tries` tries (the failed one included). */
export interface RetryContext extends RetryRequest {
  tries: number;
}

/** Whether to retry a failed request, why, and how long to wait first. */
export type RetryDecision =
  | {
      retry: true;
      reason: RetryWaitReason;
      delayMs: number;
      /** The node's `Retry-After`, in milliseconds, when it sent one. */
      retryAfterMs?: number;
    }
  | { retry: false; reason: RetryReason; retryAfterMs?: number };

/** A request about to wait before it is retried. */
export interface RetryWait {
  reason: RetryWaitReason;
  /** How long it waits, in milliseconds; 0 retries at once. */
  delayMs: number;
  /** When the retry starts, in epoch milliseconds. */
  until: number;
  /** The node's `Retry-After`, in milliseconds, when it sent one. */
  retryAfterMs?: number;
  /** Which retry this is, from 1. */
  retry: number;
  /** The most retries the request makes (`maxTries - 1`). */
  maxRetries: number;
  method: RetryRequest['method'];
  path: string;
  /** The HTTP status, unless the request got no response. */
  status?: number;
  /** The error the failed try threw. */
  error: unknown;
}

/**
 * How failed requests are retried. Every field has a default
 * ({@link DEFAULT_RETRY_POLICY}); pass only the ones to change.
 */
export interface RetryPolicy {
  /**
   * Tries in all, the first included; 1 turns retries off. Default 5. Not even
   * `decide` retries past it.
   */
  maxTries: number;
  /** The longest backoff, in milliseconds. Default 10 000. */
  maxBackoffMs: number;
  /**
   * The longest `Retry-After` honoured, in milliseconds. A longer one gives
   * up at once (`retry-after-too-long`), so the caller can wait or go to
   * another node. Default 30 000.
   */
  maxRetryAfterMs: number;
  /**
   * The least wait, in milliseconds, before retrying a 429 or a busy 503 that
   * came with no `Retry-After` (or `Retry-After: 0`), a refused connection
   * (`ECONNREFUSED`), or a browser's failed fetch. Default 1000.
   */
  busyMinDelayMs: number;
  /**
   * The backoff before retry `retry` (from 1), in milliseconds, before
   * `maxBackoffMs` caps it. Default 0, then 2, 4, 8 s.
   */
  backoffMs: (retry: number) => number;
  /** The HTTP statuses that may be retried. Replaces the default list. */
  retryStatuses: readonly number[];
  /** The network error codes that may be retried. Replaces the default list. */
  networkCodes: readonly string[];
  /**
   * Overrides any decision. Gets the error, the request and the policy's own
   * decision; returns the one to follow, within `maxTries`. An exception it
   * throws is thrown to the caller.
   */
  decide?: (
    err: unknown,
    ctx: RetryContext,
    defaultDecision: RetryDecision
  ) => RetryDecision;
  /**
   * Called before every retry, those with no wait included, to tell the app
   * that a request is rate limited, waiting for a busy node, or retrying. The
   * wait is frozen and, when it waits (`delayMs > 0`), already in the
   * client's `waits`. An exception it throws, or a promise it rejects, is
   * ignored.
   */
  onWait?: (wait: RetryWait) => void;
  /** How to wait. Default: a timer that an abort of `signal` ends early. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** A policy to merge with the defaults, or `false` for no retries. */
export type RetryOptions = Partial<RetryPolicy> | false;

/** The default retry policy. */
export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicy> = Object.freeze({
  maxTries: 5,
  maxBackoffMs: 10_000,
  maxRetryAfterMs: 30_000,
  busyMinDelayMs: 1000,
  backoffMs: (retry: number) => (retry <= 1 ? 0 : 1000 * 2 ** (retry - 1)),
  retryStatuses: Object.freeze([408, 429, 500, 502, 503, 504]),
  networkCodes: DEFAULT_NETWORK_ERROR_CODES,
});

/** A numeric policy field, or its default when it is not a number or NaN. */
function numberOr(
  value: unknown,
  key: 'maxTries' | 'maxBackoffMs' | 'maxRetryAfterMs' | 'busyMinDelayMs'
): number {
  return typeof value === 'number' && !Number.isNaN(value)
    ? value
    : DEFAULT_RETRY_POLICY[key];
}

/**
 * A full retry policy: the defaults, with the fields of `options` that are not
 * undefined. `false` gives a policy with no retries.
 */
export function retryPolicy(options?: RetryOptions): RetryPolicy {
  if (options === false) return { ...DEFAULT_RETRY_POLICY, maxTries: 1 };
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY };
  if (options) {
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) (policy as any)[key] = value;
    }
  }
  // A NaN or a 0 would retry forever or never send: keep at least one try
  policy.maxTries = Math.max(1, numberOr(policy.maxTries, 'maxTries'));
  for (const key of [
    'maxBackoffMs',
    'maxRetryAfterMs',
    'busyMinDelayMs',
  ] as const) {
    policy[key] = Math.max(0, numberOr(policy[key], key));
  }
  return policy;
}

/** A delay as a finite number of milliseconds, at least 0. */
function finiteDelay(ms: unknown): number {
  return typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

function trimPath(path: string) {
  return path.replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/**
 * Whether a request runs under the node's time limit, so a 504 means it ran
 * too long and a retry would do the same: `POST /v2/query`,
 * `POST /v2/transactions/simulate`, `GET /v2/deltas/{round}`, and `GET` of a
 * `/v2/.../versions` or `/v2/.../holders` listing (not algod's own
 * `GET /versions`). Split or narrow it instead.
 */
export function isTimeLimitedRequest(
  method: RetryRequest['method'],
  path: string
): boolean {
  const p = trimPath(path);
  if (method === 'post') {
    return p === '/v2/query' || p === '/v2/transactions/simulate';
  }
  if (method === 'get') {
    return /^\/v2\/.+\/(versions|holders)$|^\/v2\/deltas\/\d+$/.test(p);
  }
  return false;
}

/**
 * Whether a request must not be sent twice: `POST /v2/transactions` and
 * `POST /v2/transactions/async`. If the node took the transactions but the
 * answer was lost, a retry gets "transaction already in ledger" instead of the
 * transaction ID. They are retried only when the node surely did not take
 * them: a 429, a busy 503, or a connection that was refused or never made.
 */
export function isNonIdempotentRequest(
  method: RetryRequest['method'],
  path: string
): boolean {
  const p = trimPath(path);
  return (
    method === 'post' &&
    (p === '/v2/transactions' || p === '/v2/transactions/async')
  );
}

/** Network errors where the request surely never reached the node. */
const NOT_SENT_CODES = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
];

function giveUp(reason: RetryReason, retryAfterMs?: number): RetryDecision {
  return retryAfterMs === undefined
    ? { retry: false, reason }
    : { retry: false, reason, retryAfterMs };
}

function defaultDecision(
  err: unknown,
  ctx: RetryContext,
  policy: RetryPolicy
): RetryDecision {
  if (ctx.signal?.aborted) return { retry: false, reason: 'aborted' };
  const { status } = describe(err);
  let reason: RetryWaitReason;
  let minDelayMs = 0;
  let retryAfterMs: number | undefined;
  let notSent = false;
  if (typeof status === 'number') {
    if (status === 503 && isHistoryUnavailable(err)) {
      return { retry: false, reason: 'history-unavailable' };
    }
    if (status === 504 && isTimeLimitedRequest(ctx.method, ctx.path)) {
      return { retry: false, reason: 'time-limit' };
    }
    if (!policy.retryStatuses.includes(status)) {
      return { retry: false, reason: 'not-retryable' };
    }
    if (status === 429) {
      reason = 'rate-limited';
      notSent = true;
    } else if (isNodeBusy(err)) {
      reason = 'node-busy';
      notSent = true;
    } else {
      reason = 'server-error';
    }
    if (status === 429 || status === 503) {
      const seconds = retryAfterSeconds(err);
      if (seconds !== undefined) retryAfterMs = seconds * 1000;
    }
    if (notSent && !retryAfterMs) {
      minDelayMs = policy.busyMinDelayMs;
    }
  } else if (isNetworkError(err, policy.networkCodes)) {
    reason = 'network';
    const code = networkErrorCode(err);
    notSent = code !== undefined && NOT_SENT_CODES.includes(code);
    // A refused connection may be the node's connection limit, and a browser's
    // failed fetch a 429 it couldn't read: don't hammer it.
    if (code === 'ECONNREFUSED' || code === undefined) {
      minDelayMs = policy.busyMinDelayMs;
    }
  } else {
    return { retry: false, reason: 'not-retryable' };
  }
  if (!notSent && isNonIdempotentRequest(ctx.method, ctx.path)) {
    return giveUp('not-idempotent', retryAfterMs);
  }
  if (ctx.tries >= policy.maxTries) {
    return giveUp('max-tries', retryAfterMs);
  }
  if (retryAfterMs !== undefined && retryAfterMs > policy.maxRetryAfterMs) {
    return giveUp('retry-after-too-long', retryAfterMs);
  }
  const backoffMs = Math.min(
    finiteDelay(policy.backoffMs(ctx.tries)),
    finiteDelay(policy.maxBackoffMs)
  );
  const delayMs = Math.max(backoffMs, minDelayMs, retryAfterMs ?? 0);
  return retryAfterMs === undefined
    ? { retry: true, reason, delayMs }
    : { retry: true, reason, delayMs, retryAfterMs };
}

/**
 * Whether to retry a request that failed, and after how long, by the policy
 * in DTALGOSDK.md ("Retries"). In order:
 * - an aborted request is not retried;
 * - a 503 for history the node can't serve, a 504 from a request under the
 *   node's time limit ({@link isTimeLimitedRequest}), a status not in
 *   `retryStatuses` and an error that is no network error are not retried;
 * - a transaction submit ({@link isNonIdempotentRequest}) is retried only
 *   when the node surely did not take it;
 * - after `maxTries` tries, or with a `Retry-After` above `maxRetryAfterMs`,
 *   it gives up;
 * - otherwise it waits the backoff, at least `Retry-After` (429 and 503), and
 *   at least `busyMinDelayMs` for a 429 or a busy 503 without one (or with
 *   0), a refused connection, or a browser's failed fetch.
 *
 * `policy.decide` can then override the decision; {@link callWithRetry} still
 * stops after `maxTries`.
 *
 * @param err - The error the failed try threw.
 * @param ctx - The request, and how many tries it has made.
 * @param options - The policy, merged with the defaults.
 */
export function retryDecision(
  err: unknown,
  ctx: RetryContext,
  options?: RetryOptions
): RetryDecision {
  const policy = retryPolicy(options);
  const decision = defaultDecision(err, ctx, policy);
  return policy.decide ? policy.decide(err, ctx, decision) : decision;
}

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const err = new Error('This operation was aborted');
  err.name = 'AbortError';
  return err;
}

/** The longest delay setTimeout takes; a longer one fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Waits `ms` milliseconds (at most about 24.8 days), or rejects with the
 * signal's reason as soon as it aborts. A signal without `addEventListener` is
 * checked only before the wait.
 */
export function sleepUnlessAborted(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const listens =
      typeof signal?.addEventListener === 'function' &&
      typeof signal?.removeEventListener === 'function';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    if (listens) signal!.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(
      () => {
        if (listens) signal!.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.min(finiteDelay(ms), MAX_TIMER_MS)
    );
  });
}

function notify(onWait: RetryPolicy['onWait'], wait: RetryWait) {
  if (!onWait) return;
  try {
    const result = onWait(wait) as unknown;
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(() => {});
    }
  } catch {
    // A broken listener must not break the request
  }
}

/**
 * Runs a request, retrying it by the policy (see {@link retryDecision}). The
 * error of the last try is thrown as is; an abort during a wait rejects with
 * the signal's reason.
 *
 * @param send - Sends the request once.
 * @param request - The request, for the decisions.
 * @param options - The policy, merged with the defaults.
 * @param waits - If given, each wait is in it while it lasts.
 */
export async function callWithRetry<T>(
  send: () => Promise<T>,
  request: RetryRequest,
  options?: RetryOptions,
  waits?: Set<RetryWait>
): Promise<T> {
  const policy = retryPolicy(options);
  const sleep = policy.sleep ?? sleepUnlessAborted;
  const { signal } = request;
  /* eslint-disable no-await-in-loop */
  for (let tries = 1; ; tries++) {
    if (signal?.aborted) throw abortReason(signal);
    try {
      return await send();
    } catch (err) {
      const decision = retryDecision(err, { ...request, tries }, policy);
      if (!decision.retry || tries >= policy.maxTries) throw err;
      const delayMs = finiteDelay(decision.delayMs);
      const wait: RetryWait = {
        reason: decision.reason,
        delayMs,
        until: Date.now() + delayMs,
        retry: tries,
        maxRetries: policy.maxTries - 1,
        method: request.method,
        path: request.path,
        status: describe(err).status,
        error: err,
      };
      if (decision.retryAfterMs !== undefined) {
        wait.retryAfterMs = decision.retryAfterMs;
      }
      Object.freeze(wait);
      if (delayMs > 0) waits?.add(wait);
      try {
        notify(policy.onWait, wait);
        if (delayMs > 0) await sleep(delayMs, signal);
      } finally {
        waits?.delete(wait);
      }
    }
  }
  /* eslint-enable no-await-in-loop */
}

const WAIT_REASONS: Record<RetryWaitReason, (wait: RetryWait) => string> = {
  'rate-limited': () => 'The node is rate limiting requests',
  'node-busy': () => 'The node is busy',
  'server-error': (wait) => `The node answered ${wait.status ?? 'an error'}`,
  network: () => 'Could not reach the node',
};

/**
 * A message for a wait, to show users, e.g. "The node is rate limiting
 * requests: retrying in 3 s (retry 2 of 4)".
 */
export function formatRetryWait(wait: RetryWait): string {
  const seconds = Math.ceil(wait.delayMs / 1000);
  const when = seconds > 0 ? `retrying in ${seconds} s` : 'retrying now';
  const what = WAIT_REASONS[wait.reason]?.(wait) ?? 'The request failed';
  return `${what}: ${when} (retry ${wait.retry} of ${wait.maxRetries})`;
}

/**
 * Marks a BaseHTTPClient that retries, so {@link withRetry} does not wrap it
 * again. A registered symbol, so it holds across copies of the SDK.
 */
export const RETRYING_CLIENT: unique symbol = Symbol.for(
  'dt-algosdk.retrying-client'
);

/** Whether a BaseHTTPClient already retries ({@link RETRYING_CLIENT}). */
export function isRetryingClient(client: unknown): boolean {
  return (
    !!client &&
    typeof client === 'object' &&
    (client as Record<symbol, unknown>)[RETRYING_CLIENT] === true
  );
}

/** The abort signal in fetch options passed as `customOptions`, if any. */
function signalOf(
  customOptions?: Record<string, unknown>
): AbortSignal | undefined {
  // Duck-typed: a signal from another realm (e.g. jsdom) isn't an instance of this one's AbortSignal
  const signal = customOptions?.signal as AbortSignal | undefined;
  return signal && typeof signal === 'object' && 'aborted' in signal
    ? signal
    : undefined;
}

/**
 * A BaseHTTPClient that retries the requests of another by a retry policy.
 * Make one with {@link withRetry}.
 */
export class RetryingHTTPClient implements BaseHTTPClient {
  readonly [RETRYING_CLIENT] = true;

  private readonly active = new Set<RetryWait>();

  /** The client that sends the requests. */
  public readonly inner: BaseHTTPClient;

  /** The policy, merged with the defaults on each request. */
  public readonly options?: RetryOptions;

  /**
   * Present when `inner` has it: a streamed POST, retried by the policy until
   * the answer's headers are in, never once its body has started.
   */
  readonly postStream?: BaseHTTPClient['postStream'];

  /**
   * @param inner - The client that sends the requests.
   * @param options - The policy, merged with the defaults.
   */
  constructor(inner: BaseHTTPClient, options?: RetryOptions) {
    this.inner = inner;
    this.options = options;
    if (typeof inner.postStream === 'function') {
      this.postStream = (
        relativePath,
        data,
        query,
        requestHeaders,
        customOptions
      ) =>
        this.send('post', relativePath, customOptions, () =>
          inner.postStream!(
            relativePath,
            data,
            query,
            requestHeaders,
            customOptions
          )
        );
    }
  }

  /** The requests waiting to be retried now, one entry each. */
  get waits(): readonly RetryWait[] {
    return [...this.active];
  }

  /** Of the requests waiting now, the one that waits longest, if any. */
  get waiting(): RetryWait | undefined {
    let latest: RetryWait | undefined;
    for (const wait of this.active) {
      if (!latest || wait.until > latest.until) latest = wait;
    }
    return latest;
  }

  private send<T>(
    method: RetryRequest['method'],
    path: string,
    customOptions: Record<string, unknown> | undefined,
    sendOnce: () => Promise<T>
  ) {
    return callWithRetry(
      sendOnce,
      { method, path, signal: signalOf(customOptions) },
      this.options,
      this.active
    );
  }

  get(
    relativePath: string,
    query?: Query<string>,
    requestHeaders?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<BaseHTTPClientResponse> {
    return this.send('get', relativePath, customOptions, () =>
      this.inner.get(relativePath, query, requestHeaders, customOptions)
    );
  }

  post(
    relativePath: string,
    data: Uint8Array,
    query?: Query<string>,
    requestHeaders?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<BaseHTTPClientResponse> {
    return this.send('post', relativePath, customOptions, () =>
      this.inner.post(relativePath, data, query, requestHeaders, customOptions)
    );
  }

  delete(
    relativePath: string,
    data?: Uint8Array,
    query?: Query<string>,
    requestHeaders?: Record<string, string>,
    customOptions?: Record<string, unknown>
  ): Promise<BaseHTTPClientResponse> {
    return this.send('delete', relativePath, customOptions, () =>
      this.inner.delete(
        relativePath,
        data,
        query,
        requestHeaders,
        customOptions
      )
    );
  }
}

/**
 * A BaseHTTPClient that retries the requests of `inner` by a retry policy, to
 * pass to `Algodv2`, `Indexer` or `DTAlgodClient`:
 *
 * ```typescript
 * import { URLTokenBaseHTTPClient, withRetry, formatRetryWait } from 'algosdk/client';
 *
 * const http = withRetry(new URLTokenBaseHTTPClient({}, server), {
 *   onWait: (wait) => console.warn(formatRetryWait(wait)),
 * });
 * // the server comes from the HTTP client: Algodv2's types still ask for one
 * const algod = new algosdk.Algodv2(http, '');
 * ```
 *
 * A client that already retries ({@link isRetryingClient}) is returned as is,
 * so requests are not retried twice over; `options` then has no effect.
 *
 * @param inner - The client that sends the requests.
 * @param options - The policy, merged with the defaults.
 */
export function withRetry(
  inner: BaseHTTPClient,
  options?: RetryOptions
): BaseHTTPClient {
  return isRetryingClient(inner)
    ? inner
    : new RetryingHTTPClient(inner, options);
}
