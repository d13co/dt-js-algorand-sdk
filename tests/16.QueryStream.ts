/* eslint-env mocha */
import assert from 'assert';
import { encode as msgpackEncode } from 'algorand-msgpack';
import {
  BaseHTTPClient,
  BaseHTTPClientResponse,
  BaseHTTPClientStreamResponse,
  Query,
} from '../src/client/baseHTTPClient';
import {
  DTAlgodClient,
  DTUnsupportedError,
  QueryLimits,
  QueryResponse,
  QueryStreamError,
  QueryStreamEvent,
  isQueryResponseTooLarge,
} from '../src/client/v2/algod/dt/index';
import {
  ServerSentEventReader,
  looksLikeServerSentEvents,
  parseQueryStreamEvent,
} from '../src/client/v2/algod/dt/queryStream';
import { withRetry } from '../src/client/retry';
import { URLTokenBaseHTTPClient } from '../src/client/urlTokenBaseHTTPClient';
import { HTTPClient } from '../src/client/client';
import { decodeMsgpack } from '../src/encoding/encoding';
import * as algosdk from '../src/index';

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64 = (s: string) => algosdk.bytesToBase64(utf8(s));
const PROGRAM = 'CjIGFrA2GgCwgQE=';

/** A body that yields `chunks` one at a time, and records a cancel. */
function bodyOf(chunks: (string | Uint8Array)[], state = { cancelled: false }) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        const c = chunks[i];
        i += 1;
        controller.enqueue(typeof c === 'string' ? utf8(c) : c);
      } else {
        controller.close();
      }
    },
    cancel() {
      // eslint-disable-next-line no-param-reassign
      state.cancelled = true;
    },
  });
}

const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

type Sent = {
  path: string;
  query: Query<string>;
  headers: Record<string, string>;
  body: Uint8Array;
  stream: boolean;
};

type StreamAnswer =
  | { status: number; json: unknown }
  | {
      chunks: (string | Uint8Array)[];
      type?: string;
      headers?: Record<string, string>;
    };

/** A BaseHTTPClient whose postStream answers with the queued answers. */
class StreamStub implements BaseHTTPClient {
  sent: Sent[] = [];

  cancel = { cancelled: false };

  private answers: StreamAnswer[];

  constructor(answers: StreamAnswer[]) {
    this.answers = answers;
  }

  private next(): StreamAnswer {
    const a = this.answers.shift();
    if (!a) throw new Error('unexpected request');
    return a;
  }

  // eslint-disable-next-line class-methods-use-this
  async get(): Promise<BaseHTTPClientResponse> {
    throw new Error('not implemented');
  }

  async post(
    path: string,
    body: Uint8Array,
    query?: Query<string>,
    headers?: Record<string, string>
  ): Promise<BaseHTTPClientResponse> {
    this.sent.push({
      path,
      query: { ...(query ?? {}) },
      headers: headers ?? {},
      body,
      stream: false,
    });
    const a = this.next();
    if ('chunks' in a) {
      const bytes = a.chunks.map((c) => (typeof c === 'string' ? utf8(c) : c));
      const all = new Uint8Array(bytes.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of bytes) {
        all.set(c, at);
        at += c.length;
      }
      return {
        status: 200,
        body: all,
        headers: {
          'content-type': a.type ?? 'application/msgpack',
          ...(a.headers ?? {}),
        },
      };
    }
    throw this.httpError(a);
  }

  // eslint-disable-next-line class-methods-use-this
  private httpError(a: { status: number; json: unknown }) {
    const text = JSON.stringify(a.json);
    return Object.assign(
      new Error(`Network request error. Received status ${a.status}`),
      { response: { status: a.status, body: utf8(text), headers: {} } }
    );
  }

  async postStream(
    path: string,
    body: Uint8Array,
    query?: Query<string>,
    headers?: Record<string, string>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    customOptions?: Record<string, unknown>
  ): Promise<BaseHTTPClientStreamResponse> {
    this.sent.push({
      path,
      query: { ...(query ?? {}) },
      headers: headers ?? {},
      body,
      stream: true,
    });
    const a = this.next();
    if (!('chunks' in a)) throw this.httpError(a);
    return {
      status: 200,
      body: bodyOf(a.chunks, this.cancel),
      headers: {
        'content-type': a.type ?? 'text/event-stream',
        ...(a.headers ?? {}),
      },
    };
  }

  // eslint-disable-next-line class-methods-use-this
  delete(): Promise<BaseHTTPClientResponse> {
    throw new Error('not implemented');
  }
}

/** A client without postStream. */
class PlainStub extends StreamStub {
  constructor(answers: StreamAnswer[]) {
    super(answers);
    (this as { postStream?: unknown }).postStream = undefined;
  }
}

/** The SSE of a request of 2 calls at rounds [5, 0, 5], latest 9. */
const STREAM = [
  sse('start', { 'last-round': 9, rounds: [5, 9, 5] }),
  sse('log', { r: 5, c: 1, i: 0, d: [b64('a'), b64('b')] }),
  sse('log', { r: 9, c: 0, i: 0, d: [b64('x')] }),
  sse('log', { r: 5, c: 1, i: 2, d: [b64('c')] }),
  sse('call', { r: 5, c: 1, logs: 3, cost: 30 }),
  sse('call', { r: 5, c: 0, logs: 0, cost: 4, error: 'logic eval error: x' }),
  sse('call', { r: 9, c: 0, logs: 1, cost: 10 }),
  ': keepalive\n\n',
  sse('round', { r: 5 }),
  sse('log', { r: 9, c: 1, i: 0, d: [b64('y')] }),
  sse('call', { r: 9, c: 1, logs: 1, cost: 11 }),
  sse('round', {
    r: 9,
    protocol: {
      from: 'v40',
      to: 'v41',
      applied: true,
      notes: [{ code: 'c', message: 'm', hits: [{ group: 1, path: [0] }] }],
    },
  }),
  sse('end', { effort: 'opcodes=5' }),
];

const query = (c: BaseHTTPClient, rounds = [5, 0, 5]) =>
  new DTAlgodClient(c, '').query({
    program: PROGRAM,
    rounds,
    calls: [{}, { args: [utf8('q')] }],
  });

const text = (logs: Uint8Array[]) =>
  logs.map((l) => new TextDecoder().decode(l));

describe('query streams', () => {
  describe('ServerSentEventReader', () => {
    const readAll = async (chunks: (string | Uint8Array)[]) => {
      const reader = new ServerSentEventReader(bodyOf(chunks));
      const events = [];
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const e = await reader.next();
        if (!e) return events;
        events.push(e);
      }
    };

    it('reads events split anywhere, in LF or CRLF, skipping comments', async () => {
      const whole =
        ': hello\r\nevent: a\r\ndata: 1\r\ndata:2\r\n\r\ndata: é\n\nevent: b\n\n: x\n\nevent: c\ndata\n\n';
      const bytes = utf8(whole);
      const expected = [
        { event: 'a', data: '1\n2' },
        { event: 'message', data: 'é' },
        { event: 'c', data: '' },
      ];
      assert.deepStrictEqual(await readAll([whole]), expected);
      // one byte at a time: a split CRLF and a split UTF-8 character
      assert.deepStrictEqual(
        await readAll(Array.from(bytes, (b) => new Uint8Array([b]))),
        expected
      );
    });

    it('takes a lone CR as a line end, also split from its LF', async () => {
      assert.deepStrictEqual(
        await readAll([
          'event: a\rdata: 1\r\r',
          'event: b\r',
          '\ndata: 2\r\n\r\n',
        ]),
        [
          { event: 'a', data: '1' },
          { event: 'b', data: '2' },
        ]
      );
    });

    it('drops an event cut off at the end', async () => {
      assert.deepStrictEqual(
        await readAll(['event: a\ndata: 1\n\nevent: b\ndata: 2\n']),
        [{ event: 'a', data: '1' }]
      );
    });

    it('ignores events it does not know', () => {
      assert.strictEqual(
        parseQueryStreamEvent({ event: 'later', data: '{}' }),
        undefined
      );
      assert.throws(
        () => parseQueryStreamEvent({ event: 'call', data: '{"r":-1}' }),
        /Invalid round/
      );
    });
  });

  describe('RunQuery.stream', () => {
    it('reports the events as they come and returns the full response', async () => {
      const stub = new StreamStub([{ chunks: STREAM }]);
      const events: QueryStreamEvent[] = [];
      const response = await query(stub).stream((e) => events.push(e));

      assert.strictEqual(stub.sent[0].path, '/v2/query');
      assert.strictEqual(stub.sent[0].query.format, 'msgpack');
      assert.strictEqual(
        stub.sent[0].headers.accept,
        'text/event-stream, application/msgpack;q=0.5'
      );
      assert.strictEqual(
        stub.sent[0].headers['content-type'],
        'application/msgpack'
      );
      assert.deepStrictEqual(
        events.map((e) => e.type),
        [
          'start',
          'logs',
          'logs',
          'logs',
          'call',
          'call',
          'call',
          'round',
          'logs',
          'call',
          'round',
          'end',
        ]
      );
      const third = events[3];
      assert.ok(third.type === 'logs');
      assert.strictEqual(third.index, 2);
      assert.deepStrictEqual(text(third.logs), ['c']);
      const end = events[events.length - 1];
      assert.deepStrictEqual(end, { type: 'end', effort: 'opcodes=5' });

      // the body ended after the end event: read to its end, not cancelled
      assert.strictEqual(stub.cancel.cancelled, false);
      assert.ok(response instanceof QueryResponse);
      assert.strictEqual(response.lastRound, 9n);
      assert.deepStrictEqual(
        response.rounds.map((r) => r.round),
        [5n, 9n, 5n]
      );
      const [r5, r9, r5again] = response.rounds;
      assert.deepStrictEqual(text(r5.calls[1].logs), ['a', 'b', 'c']);
      assert.strictEqual(r5.calls[1].cost, 30);
      assert.strictEqual(r5.calls[0].error, 'logic eval error: x');
      assert.deepStrictEqual(r5.calls[0].logs, []);
      assert.deepStrictEqual(text(r5again.calls[1].logs), ['a', 'b', 'c']);
      assert.strictEqual(r9.protocolOverride?.to, 'v41');
      assert.deepStrictEqual(r9.protocolOverride?.notes?.[0].hits?.[0].path, [
        0,
      ]);
      assert.strictEqual(r5.protocolOverride, undefined);
    });

    it('gives the same response as do() for the same answer', async () => {
      const full = {
        'last-round': 9,
        rounds: [
          {
            round: 5,
            calls: [
              { cost: 4, error: 'logic eval error: x' },
              { cost: 30, logs: [utf8('a'), utf8('b'), utf8('c')] },
            ],
          },
          {
            round: 9,
            protocol: {
              from: 'v40',
              to: 'v41',
              applied: true,
              notes: [
                { code: 'c', message: 'm', hits: [{ group: 1, path: [0] }] },
              ],
            },
            calls: [
              { cost: 10, logs: [utf8('x')] },
              { cost: 11, logs: [utf8('y')] },
            ],
          },
          {
            round: 5,
            calls: [
              { cost: 4, error: 'logic eval error: x' },
              { cost: 30, logs: [utf8('a'), utf8('b'), utf8('c')] },
            ],
          },
        ],
      };
      const fromDo = decodeMsgpack(msgpackEncode(full), QueryResponse);
      const streamed = await query(
        new StreamStub([{ chunks: STREAM }])
      ).stream();
      assert.deepStrictEqual(
        algosdk.encodeMsgpack(streamed),
        algosdk.encodeMsgpack(fromDo)
      );

      // and a node that answers in full, to the same request, is replayed
      const events: QueryStreamEvent[] = [];
      const replayed = await query(
        new StreamStub([
          {
            chunks: [msgpackEncode(full)],
            type: 'application/msgpack',
            headers: { 'X-Algod-Effort': 'opcodes=5' },
          },
        ])
      ).stream((e) => events.push(e));
      assert.deepStrictEqual(
        algosdk.encodeMsgpack(replayed),
        algosdk.encodeMsgpack(fromDo)
      );
      assert.deepStrictEqual(
        events.map((e) => [e.type, 'round' in e ? e.round : undefined]),
        [
          ['start', undefined],
          ['call', 5n],
          ['logs', 5n],
          ['call', 5n],
          ['round', 5n],
          ['logs', 9n],
          ['call', 9n],
          ['logs', 9n],
          ['call', 9n],
          ['round', 9n],
          ['end', undefined],
        ]
      );
      assert.deepStrictEqual(events[events.length - 1], {
        type: 'end',
        effort: 'opcodes=5',
      });
    });

    it('takes a stream whose type a proxy changed or dropped by its body', async () => {
      const events: QueryStreamEvent[] = [];
      const response = await query(
        new StreamStub([{ chunks: STREAM, type: 'text/plain' }])
      ).stream((e) => events.push(e));
      assert.strictEqual(response.rounds.length, 3);
      assert.strictEqual(events.filter((e) => e.type === 'logs').length, 4);

      // past a BOM and blank lines too
      for (const prefix of ['\uFEFF', '\n', '\r\n\r\n', '\uFEFF\n']) {
        // eslint-disable-next-line no-await-in-loop
        const prefixed = await query(
          new StreamStub([{ chunks: [prefix, ...STREAM], type: 'text/plain' }])
        ).stream();
        assert.strictEqual(prefixed.rounds.length, 3, JSON.stringify(prefix));
      }
      assert.ok(!looksLikeServerSentEvents(msgpackEncode({ a: 1 })));
      assert.ok(!looksLikeServerSentEvents(new Uint8Array()));
    });

    it('closes the connection at once when onEvent throws on the end event', async () => {
      // a body that stays open after the end event
      const stub = new StreamStub([{ chunks: STREAM }]);
      const realPostStream = stub.postStream.bind(stub);
      stub.postStream = async (...args) => {
        const res = await realPostStream(...args);
        const reader = res.body.getReader();
        res.body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { value, done } = await reader.read();
            if (!done) controller.enqueue(value);
            // never closes
          },
          cancel() {
            stub.cancel.cancelled = true;
          },
        });
        return res;
      };
      const start = Date.now();
      await assert.rejects(
        query(stub).stream((e) => {
          if (e.type === 'end') throw new Error('done here');
        }),
        /done here/
      );
      assert.ok(stub.cancel.cancelled);
      assert.ok(Date.now() - start < 500);
    });

    it('answers in full through an HTTP client that cannot stream', async () => {
      const full = {
        'last-round': 9,
        rounds: [{ round: 9, calls: [{ cost: 1 }, { cost: 2 }] }],
      };
      const stub = new PlainStub([{ chunks: [msgpackEncode(full)] }]);
      assert.strictEqual(new HTTPClient(stub).canStream(), false);
      const events: QueryStreamEvent[] = [];
      const response = await query(stub, []).stream((e) => events.push(e));
      assert.strictEqual(stub.sent[0].stream, false);
      assert.strictEqual(stub.sent[0].headers.accept, undefined);
      assert.strictEqual(response.rounds[0].calls[1].cost, 2);
      assert.deepStrictEqual(
        events.map((e) => e.type),
        ['start', 'call', 'call', 'round', 'end']
      );
    });

    it('voids a failed round: its result has the error and no calls', async () => {
      const response = await query(
        new StreamStub([
          {
            chunks: [
              sse('start', { 'last-round': 9, rounds: [5] }),
              sse('log', { r: 5, c: 0, i: 0, d: [b64('a')] }),
              sse('call', { r: 5, c: 0, logs: 1, cost: 1 }),
              sse('round', { r: 5, error: 'reading round 5 failed: x' }),
              sse('end', {}),
            ],
          },
        ]),
        [5]
      ).stream();
      assert.strictEqual(response.rounds[0].error, 'reading round 5 failed: x');
      assert.deepStrictEqual(response.rounds[0].calls, []);
    });

    it('throws a QueryStreamError the error helpers know when the node stops the stream', async () => {
      const events: QueryStreamEvent[] = [];
      await assert.rejects(
        query(
          new StreamStub([
            {
              chunks: [
                sse('start', { 'last-round': 9, rounds: [5] }),
                sse('log', { r: 5, c: 0, i: 0, d: [b64('a')] }),
                sse('end', {
                  error: 'query response too large',
                  status: 400,
                }),
              ],
            },
          ]),
          [5]
        ).stream((e) => events.push(e)),
        (err: unknown) => {
          assert.ok(err instanceof QueryStreamError);
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.truncated, false);
          assert.ok(isQueryResponseTooLarge(err));
          assert.strictEqual(
            JSON.parse(err.response!.text).message,
            'query response too large'
          );
          return true;
        }
      );
      assert.deepStrictEqual(
        events.map((e) => e.type),
        ['start', 'logs', 'end']
      );
    });

    it('throws a truncated QueryStreamError for a stream without its end', async () => {
      await assert.rejects(
        query(
          new StreamStub([
            {
              chunks: [
                sse('start', { 'last-round': 9, rounds: [5] }),
                sse('call', { r: 5, c: 0, logs: 0, cost: 1 }),
              ],
            },
          ]),
          [5]
        ).stream(),
        (err: unknown) =>
          err instanceof QueryStreamError &&
          err.truncated &&
          err.status === undefined
      );
    });

    it('rejects a stream that breaks its rules', async () => {
      const cases: [string[], RegExp][] = [
        [
          [
            sse('start', { 'last-round': 9, rounds: [5] }),
            sse('log', { r: 5, c: 0, i: 1, d: [b64('a')] }),
          ],
          /sent log 1 of call 0 at round 5 after 0 logs/,
        ],
        [
          [
            sse('start', { 'last-round': 9, rounds: [5] }),
            sse('log', { r: 5, c: 0, i: 0, d: [b64('a')] }),
            sse('call', { r: 5, c: 0, logs: 2, cost: 1 }),
          ],
          /made 2 logs, and the query stream sent 1/,
        ],
        [
          [
            sse('start', { 'last-round': 9, rounds: [5] }),
            sse('call', { r: 6, c: 0, logs: 0, cost: 1 }),
          ],
          /round 6, which its start didn't list/,
        ],
        [
          [
            sse('start', { 'last-round': 9, rounds: [5] }),
            sse('round', { r: 5 }),
            sse('end', {}),
          ],
          /without reporting call 0 at round 5/,
        ],
        [
          [sse('start', { 'last-round': 9, rounds: [5] }), sse('end', {})],
          /without reporting round 5/,
        ],
        [[sse('call', { r: 5, c: 0 })], /before its start/],
      ];
      for (const [chunks, error] of cases) {
        const stub = new StreamStub([{ chunks }]);
        // eslint-disable-next-line no-await-in-loop
        await assert.rejects(query(stub, [5]).stream(), error);
      }
    });

    it('turns a failed read into a truncated QueryStreamError, but keeps an abort', async () => {
      const failing = (error: Error) => {
        const stub = new StreamStub([{ chunks: [] }]);
        stub.postStream = async () => {
          let sent = false;
          return {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
            body: new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!sent) {
                  sent = true;
                  controller.enqueue(
                    utf8(sse('start', { 'last-round': 9, rounds: [5] }))
                  );
                } else {
                  controller.error(error);
                }
              },
            }),
          };
        };
        return stub;
      };
      const cut = new TypeError('terminated');
      await assert.rejects(
        query(failing(cut), [5]).stream(),
        (err: unknown) =>
          err instanceof QueryStreamError &&
          err.truncated &&
          err.cause === cut &&
          /cut off before its end: terminated/.test(err.message)
      );
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      await assert.rejects(
        query(failing(abort), [5]).stream(),
        (err: unknown) => err === abort
      );
    });

    it('turns a failed read of a full answer into a truncated QueryStreamError, but keeps an abort', async () => {
      const failing = (error: Error) => {
        const stub = new StreamStub([{ chunks: [] }]);
        stub.postStream = async () => ({
          status: 200,
          headers: { 'content-type': 'application/msgpack' },
          body: new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(error);
            },
          }),
        });
        return stub;
      };
      const cut = new TypeError('terminated');
      await assert.rejects(
        query(failing(cut), [5]).stream(),
        (err: unknown) =>
          err instanceof QueryStreamError &&
          err.truncated &&
          err.cause === cut &&
          /query answer was cut off before its end: terminated/.test(
            err.message
          )
      );
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      await assert.rejects(
        query(failing(abort), [5]).stream(),
        (err: unknown) => err === abort
      );
    });

    it('stops on an abort of the signal in customOptions', async () => {
      // As fetch does: an aborted signal rejects the request, and an abort
      // once the headers are in errors the body with the signal's reason
      const aborting = () => {
        const stub = new StreamStub([]);
        const seen = { signal: undefined as AbortSignal | undefined };
        stub.postStream = async (_p, _d, _q, _h, customOptions) => {
          const signal = customOptions?.signal as AbortSignal;
          seen.signal = signal;
          if (signal.aborted) throw signal.reason;
          const chunks = [...STREAM];
          return {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                signal.addEventListener('abort', () =>
                  controller.error(signal.reason)
                );
              },
              pull(controller) {
                const next = chunks.shift();
                if (next === undefined) controller.close();
                else controller.enqueue(utf8(next));
              },
            }),
          };
        };
        return { stub, seen };
      };

      // aborted while the stream runs
      const running = aborting();
      const controller = new AbortController();
      const events: QueryStreamEvent[] = [];
      await assert.rejects(
        query(running.stub).stream(
          (e) => {
            events.push(e);
            if (e.type === 'logs') controller.abort();
          },
          undefined,
          { signal: controller.signal }
        ),
        (err: unknown) => err === controller.signal.reason
      );
      assert.strictEqual(running.seen.signal, controller.signal);
      assert.ok(!events.some((e) => e.type === 'end'));

      // aborted before the request
      const early = aborting();
      const aborted = new AbortController();
      aborted.abort();
      await assert.rejects(
        query(early.stub).stream(undefined, undefined, {
          signal: aborted.signal,
        }),
        (err: unknown) => err === aborted.signal.reason
      );
    });

    it('stops the request on an exception of onEvent', async () => {
      const stub = new StreamStub([{ chunks: STREAM }]);
      await assert.rejects(
        query(stub).stream((e) => {
          if (e.type === 'logs') throw new Error('stop');
        }),
        /stop/
      );
      assert.ok(stub.cancel.cancelled);
    });

    it('throws errors before the stream as do() does', async () => {
      await assert.rejects(
        query(
          new StreamStub([
            {
              status: 400,
              json: { message: 'query is disabled on this node' },
            },
          ])
        ).stream(),
        DTUnsupportedError
      );
      await assert.rejects(
        new DTAlgodClient(new StreamStub([]), '')
          .query({ program: PROGRAM, calls: [] })
          .stream(),
        /at least one call/
      );
    });

    it('retries until the stream starts, never after', async () => {
      const stub = new StreamStub([
        { status: 503, json: { message: 'the node is busy' } },
        { chunks: STREAM },
      ]);
      const retrying = withRetry(stub, { sleep: async () => {} });
      assert.strictEqual(typeof retrying.postStream, 'function');
      const response = await query(retrying).stream();
      assert.strictEqual(stub.sent.length, 2);
      assert.strictEqual(response.rounds.length, 3);
      // A client over one without postStream has none either
      assert.strictEqual(withRetry(new PlainStub([])).postStream, undefined);
    });
  });

  it('reads a whole answer when fetch has no streaming bodies', async () => {
    const realFetch = globalThis.fetch;
    const whole = STREAM.join('');
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: undefined,
      arrayBuffer: async () => utf8(whole).buffer,
    })) as unknown as typeof fetch;
    try {
      const client = new URLTokenBaseHTTPClient({}, 'http://127.0.0.1', 9);
      const response = await query(client).stream();
      assert.strictEqual(response.rounds.length, 3);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('decodes the query limits stream list', () => {
    const limits = QueryLimits.fromEncodingData(
      new Map<string, unknown>([
        ['max-calls', 4],
        ['stream', ['sse']],
      ])
    );
    assert.deepStrictEqual(limits.stream, ['sse']);
    assert.deepStrictEqual(QueryLimits.fromEncodingData(new Map()).stream, []);
    assert.ok(DTAlgodClient.features.includes('query-stream'));
  });
});

/**
 * Live: the stream and do() agree on a real node. Skipped unless
 * DT_QUERY_STREAM_SERVER is set, e.g. DT_QUERY_STREAM_SERVER=http://127.0.0.1:8098
 * (a node that streams, or one that doesn't: then stream() answers in full).
 */
describe('query streams against a live node', function liveSuite() {
  this.timeout(60_000);
  const env = typeof process !== 'undefined' ? process.env : {};
  const server = env.DT_QUERY_STREAM_SERVER;

  it('streams what do() returns', async function live() {
    if (!server) this.skip();
    const url = new URL(server!);
    const c = new DTAlgodClient(
      env.DT_ALGOD_TOKEN ?? '',
      `${url.protocol}//${url.hostname}`,
      url.port
    );
    const { lastRound } = await c.status().do();
    const caps = await c.capabilities();
    const rounds = [lastRound - 10n, 0n, lastRound - 1000n, lastRound - 10n];
    const calls = Array.from({ length: 50 }, (_, i) => ({
      args: [utf8(`call ${i}`)],
    }));
    const request = () =>
      c.query({ program: PROGRAM, rounds, protocol: 'latest', calls });
    const events: QueryStreamEvent[] = [];
    // stream() replays a full answer as the same events: only the answer's
    // type tells whether the node streamed
    const types: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await realFetch(...args);
      types.push(res.headers.get('content-type') ?? '');
      return res;
    };
    let streamed: QueryResponse;
    try {
      streamed = await request().stream((e) => events.push(e));
    } finally {
      globalThis.fetch = realFetch;
    }
    if (caps.query?.stream.includes('sse')) {
      assert.deepStrictEqual(
        types.map((t) => t.split(';')[0]),
        ['text/event-stream']
      );
    }
    const full = await request()
      .rounds(streamed.rounds.map((r) => r.round))
      .do();
    assert.deepStrictEqual(
      algosdk.encodeMsgpack(
        new QueryResponse({ lastRound: 0n, rounds: streamed.rounds })
      ),
      algosdk.encodeMsgpack(
        new QueryResponse({ lastRound: 0n, rounds: full.rounds })
      )
    );
    assert.strictEqual(events[0].type, 'start');
    assert.strictEqual(events[events.length - 1].type, 'end');
    // 3 distinct rounds, 50 calls each, 2 logs per call
    assert.strictEqual(events.filter((e) => e.type === 'call').length, 150);
    assert.strictEqual(events.filter((e) => e.type === 'round').length, 3);
    // eslint-disable-next-line no-console
    console.log(
      `      ${server}: stream ${JSON.stringify(caps.query?.stream)}, ${events.length} events`
    );
  });
});
