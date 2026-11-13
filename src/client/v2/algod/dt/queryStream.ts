/**
 * Streamed answers of `POST /v2/query`: the node sends each call's logs as
 * Server-Sent Events while the calls run (`RunQuery.stream`).
 */
import { decodeJSON } from '../../../../encoding/encoding.js';
import { base64ToBytes } from '../../../../encoding/binarydata.js';
import {
  QueryCallResult,
  QueryProtocolOverride,
  QueryResponse,
  QueryRoundResult,
} from './models.js';

/** The media type of a streamed query answer. */
export const QUERY_STREAM_TYPE = 'text/event-stream';

/**
 * The first event: the request is valid and the node has read its rounds.
 * `rounds` has the round of each entry of the request's `rounds`, the latest
 * round (0) resolved; one entry, the latest round, when it listed none.
 */
export interface QueryStreamStartEvent {
  type: 'start';
  lastRound: bigint;
  rounds: bigint[];
}

/**
 * Logs of a call, as the called app makes them (not those of the apps it
 * calls). `index` is the index of the first of them among the call's logs: a
 * call's logs come in order, each once.
 */
export interface QueryStreamLogsEvent {
  type: 'logs';
  round: bigint;
  /** The call's index in the request. */
  call: number;
  index: number;
  logs: Uint8Array[];
}

/** A call ended, after its logs: how many it made, its cost and error. */
export interface QueryStreamCallEvent {
  type: 'call';
  round: bigint;
  /** The call's index in the request. */
  call: number;
  /** How many logs the call made. */
  logs: number;
  cost: number;
  error?: string;
}

/**
 * Every call of a round ended. With an `error`, the round has no results: the
 * events of its calls that came before don't count.
 */
export interface QueryStreamRoundEvent {
  type: 'round';
  round: bigint;
  protocolOverride?: QueryProtocolOverride;
  error?: string;
}

/**
 * The last event. With an `error`, the request stopped early; `status` is the
 * one a full answer would have had (400 over `maxResponseBytes`, 504 at the
 * time limit, 500). `effort` is the `X-Algod-Effort` value, with
 * `EnableEffortHeader`.
 */
export interface QueryStreamEndEvent {
  type: 'end';
  effort?: string;
  error?: string;
  status?: number;
}

/**
 * An event of a streamed query (`RunQuery.stream`). Each distinct round of the
 * request is reported once, whatever the number of entries it has in
 * `rounds`. Events of different calls interleave; those of one call come in
 * order: its logs, then its `call` event.
 */
export type QueryStreamEvent =
  | QueryStreamStartEvent
  | QueryStreamLogsEvent
  | QueryStreamCallEvent
  | QueryStreamRoundEvent
  | QueryStreamEndEvent;

/**
 * A streamed query that did not end as it should: it was cut off (the
 * connection dropped before the `end` event: `truncated`), or the node stopped
 * it early (`status` is the status a full answer would have had, e.g. 400 with
 * "query response too large", which `isQueryResponseTooLarge` recognizes, or
 * 504 at the time limit). The `status` and `response` make it look like the
 * HTTP error of a full answer to the error helpers.
 */
export class QueryStreamError extends Error {
  /** The status a full answer would have had, if the node stopped the query. */
  public status?: number;

  /** Whether the stream was cut off before its `end` event. */
  public truncated: boolean;

  /** The node's error as a full answer's error body, when it sent one. */
  public response?: {
    status: number;
    text: string;
    body: Uint8Array;
    headers: Record<string, string>;
  };

  /** For a cut-off stream, the error reading it failed with, if any. */
  public cause?: unknown;

  constructor(
    message: string,
    status?: number,
    nodeMessage?: string,
    cause?: unknown
  ) {
    super(message);
    this.name = 'QueryStreamError';
    if (cause !== undefined) this.cause = cause;
    this.status = status;
    this.truncated = status === undefined;
    if (status !== undefined) {
      const text = JSON.stringify({ message: nodeMessage ?? '' });
      this.response = {
        status,
        text,
        body: new TextEncoder().encode(text),
        headers: {},
      };
    }
  }
}

/** A Server-Sent Event: its name (`message` by default) and its data. */
export interface ServerSentEvent {
  event: string;
  data: string;
}

/**
 * Reads Server-Sent Events from a body, one at a time. Lines end in LF or
 * CRLF; comments are skipped, and so is an event cut off at the end.
 */
export class ServerSentEventReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  private readonly decoder = new TextDecoder();

  private buf = '';

  private pos = 0;

  private done = false;

  private event = '';

  private data: string[] = [];

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  /** The next event, or undefined at the end of the body. */
  async next(): Promise<ServerSentEvent | undefined> {
    for (;;) {
      const event = this.parse();
      if (event) return event;
      if (this.done) return undefined;
      // eslint-disable-next-line no-await-in-loop
      const { value, done } = await this.reader.read();
      this.buf = this.buf.slice(this.pos);
      this.pos = 0;
      if (done) {
        this.buf += this.decoder.decode();
        this.done = true;
      } else {
        this.buf += this.decoder.decode(value, { stream: true });
      }
    }
  }

  /**
   * Reads the rest of the body if it ends within `ms` with nothing in it but
   * comments, so the connection can be reused; else stops reading. Returns
   * whether it ended.
   */
  async drain(ms: number): Promise<boolean> {
    if (this.done) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), ms);
    });
    try {
      const next = await Promise.race([this.next(), late]);
      if (next === undefined) return true;
    } catch {
      // the body failed after the end: nothing to reuse
    } finally {
      clearTimeout(timer);
    }
    await this.cancel();
    return false;
  }

  /** Stops reading: closes the connection unless the body has ended. */
  async cancel(): Promise<void> {
    if (this.done) return;
    this.done = true;
    try {
      await this.reader.cancel();
    } catch {
      // the body may already have failed
    }
  }

  /** The next event in what was read, if a whole one is there. */
  private parse(): ServerSentEvent | undefined {
    for (;;) {
      // A line ends in LF, CRLF or a lone CR
      let end = this.pos;
      while (
        end < this.buf.length &&
        this.buf[end] !== '\n' &&
        this.buf[end] !== '\r'
      ) {
        end += 1;
      }
      if (end === this.buf.length) return undefined;
      let next = end + 1;
      if (this.buf[end] === '\r') {
        // a CR at the end of what was read may be the start of a CRLF
        if (next === this.buf.length && !this.done) return undefined;
        if (this.buf[next] === '\n') next += 1;
      }
      const line = this.buf.slice(this.pos, end);
      this.pos = next;
      if (line === '') {
        if (this.data.length > 0) {
          const event = {
            event: this.event || 'message',
            data: this.data.join('\n'),
          };
          this.event = '';
          this.data = [];
          return event;
        }
        this.event = '';
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') this.event = value;
        else if (field === 'data') this.data.push(value);
      }
    }
  }
}

/** The whole of a body. */
export async function readAll(
  body: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const all = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}

/** A body of `bytes`. */
export function bodyOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * Whether a body looks like Server-Sent Events: past a BOM and blank lines,
 * it starts with a field or a comment. A msgpack answer starts with a map,
 * never with these.
 */
export function looksLikeServerSentEvents(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { ignoreBOM: true })
    .decode(bytes.subarray(0, 64))
    .replace(/^\uFEFF/, '')
    .replace(/^[\r\n]+/, '');
  return /^(event:|data:|id:|retry:|:)/.test(head);
}

/** A round number of an event, as a bigint. */
function roundOf(value: unknown, what: string): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${what} in a query stream: ${value}`);
  }
  return BigInt(value);
}

/** A count or index of an event. */
function countOf(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${what} in a query stream: ${value}`);
  }
  return value;
}

/** An optional string of an event. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The query event of a Server-Sent Event, or undefined for an event this
 * client doesn't know (a newer node's).
 */
export function parseQueryStreamEvent(
  sse: ServerSentEvent
): QueryStreamEvent | undefined {
  const known = ['start', 'log', 'call', 'round', 'end'];
  if (!known.includes(sse.event)) return undefined;
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(sse.data);
  } catch {
    throw new Error(
      `Invalid ${sse.event} event in a query stream: ${sse.data}`
    );
  }
  if (typeof d !== 'object' || d === null) {
    throw new Error(
      `Invalid ${sse.event} event in a query stream: ${sse.data}`
    );
  }
  switch (sse.event) {
    case 'start': {
      const { rounds } = d;
      if (!Array.isArray(rounds)) {
        throw new Error(`Invalid start event in a query stream: ${sse.data}`);
      }
      return {
        type: 'start',
        lastRound: roundOf(d['last-round'], 'last-round'),
        rounds: rounds.map((r) => roundOf(r, 'round')),
      };
    }
    case 'log': {
      const { d: logs } = d;
      if (!Array.isArray(logs) || logs.some((l) => typeof l !== 'string')) {
        throw new Error(`Invalid log event in a query stream: ${sse.data}`);
      }
      return {
        type: 'logs',
        round: roundOf(d.r, 'round'),
        call: countOf(d.c, 'call'),
        index: countOf(d.i, 'log index'),
        logs: (logs as string[]).map((l) => base64ToBytes(l)),
      };
    }
    case 'call': {
      const error = textOf(d.error);
      return {
        type: 'call',
        round: roundOf(d.r, 'round'),
        call: countOf(d.c, 'call'),
        logs: countOf(d.logs ?? 0, 'log count'),
        cost: countOf(d.cost ?? 0, 'cost'),
        ...(error !== undefined ? { error } : {}),
      };
    }
    case 'round': {
      const error = textOf(d.error);
      const event: QueryStreamRoundEvent = {
        type: 'round',
        round: roundOf(d.r, 'round'),
      };
      if (d.protocol !== undefined && d.protocol !== null) {
        event.protocolOverride = decodeJSON(
          JSON.stringify(d.protocol),
          QueryProtocolOverride
        );
      }
      if (error !== undefined) event.error = error;
      return event;
    }
    default: {
      const event: QueryStreamEndEvent = { type: 'end' };
      const effort = textOf(d.effort);
      const error = textOf(d.error);
      if (effort !== undefined) event.effort = effort;
      if (error !== undefined) event.error = error;
      if (d.status !== undefined && d.status !== 0) {
        event.status = countOf(d.status, 'status');
      }
      return event;
    }
  }
}

/** What has come for a round. */
interface RoundState {
  logs: Uint8Array[][];
  calls: (QueryStreamCallEvent | undefined)[];
  end?: QueryStreamRoundEvent;
}

/**
 * Builds a query's response from its events, checking that they are what the
 * node promises: a start first, logs in order, each call's log count, every
 * round and call reported, and an end without an error last.
 */
export class QueryStreamAssembler {
  private start?: QueryStreamStartEvent;

  private rounds = new Map<bigint, RoundState>();

  private end?: QueryStreamEndEvent;

  private readonly calls: number;

  /** @param calls - How many calls the request has. */
  constructor(calls: number) {
    this.calls = calls;
  }

  /** Whether the end event came. */
  get ended(): boolean {
    return this.end !== undefined;
  }

  /** Takes in the next event; throws if it breaks the stream's rules. */
  add(event: QueryStreamEvent): void {
    if (this.end) {
      throw new Error(`A query stream has a ${event.type} event after its end`);
    }
    if (event.type === 'end') {
      this.end = event;
      return;
    }
    if (event.type === 'start') {
      if (this.start) throw new Error('A query stream has two start events');
      this.start = event;
      for (const round of event.rounds) {
        if (!this.rounds.has(round)) {
          this.rounds.set(round, {
            logs: Array.from({ length: this.calls }, () => []),
            calls: new Array(this.calls).fill(undefined),
          });
        }
      }
      return;
    }
    if (!this.start) {
      throw new Error(
        `A query stream has a ${event.type} event before its start`
      );
    }
    const state = this.rounds.get(event.round);
    if (!state) {
      throw new Error(
        `A query stream has a ${event.type} event for round ${event.round}, which its start didn't list`
      );
    }
    if (state.end) {
      throw new Error(
        `A query stream has a ${event.type} event for round ${event.round} after the round ended`
      );
    }
    if (event.type === 'round') {
      state.end = event;
      return;
    }
    if (event.call >= this.calls) {
      throw new Error(
        `A query stream has a ${event.type} event for call ${event.call} of a request with ${this.calls} calls`
      );
    }
    if (state.calls[event.call]) {
      throw new Error(
        `A query stream has a ${event.type} event for call ${event.call} at round ${event.round} after the call ended`
      );
    }
    const logs = state.logs[event.call];
    if (event.type === 'logs') {
      if (event.index !== logs.length) {
        throw new Error(
          `A query stream sent log ${event.index} of call ${event.call} at round ${event.round} after ${logs.length} logs`
        );
      }
      logs.push(...event.logs);
      return;
    }
    if (event.logs !== logs.length) {
      throw new Error(
        `Call ${event.call} at round ${event.round} made ${event.logs} logs, and the query stream sent ${logs.length}`
      );
    }
    state.calls[event.call] = event;
  }

  /**
   * The response, as a full answer would have it, once the end came. Throws a
   * {@link QueryStreamError} for a stream that was cut off or that the node
   * stopped, and an `Error` for one that is missing results.
   */
  response(): QueryResponse {
    if (!this.end) {
      throw new QueryStreamError(
        'The query stream was cut off before its end: the connection dropped'
      );
    }
    if (this.end.error !== undefined || this.end.status !== undefined) {
      const message = this.end.error ?? 'unknown error';
      throw new QueryStreamError(
        `The node stopped the query stream${this.end.status ? ` with status ${this.end.status}` : ''}: ${message}`,
        this.end.status ?? 500,
        message
      );
    }
    if (!this.start) throw new Error('A query stream ended without a start');
    const results = new Map<bigint, QueryRoundResult>();
    for (const [round, state] of this.rounds) {
      if (!state.end) {
        throw new Error(
          `A query stream ended without reporting round ${round}`
        );
      }
      const { protocolOverride, error } = state.end;
      let calls: QueryCallResult[] = [];
      if (error === undefined) {
        calls = state.calls.map((call, i) => {
          if (!call) {
            throw new Error(
              `A query stream ended without reporting call ${i} at round ${round}`
            );
          }
          return new QueryCallResult({
            logs: state.logs[i],
            cost: call.cost,
            error: call.error,
          });
        });
      }
      results.set(
        round,
        new QueryRoundResult({ round, protocolOverride, error, calls })
      );
    }
    return new QueryResponse({
      lastRound: this.start.lastRound,
      rounds: this.start.rounds.map((round) => {
        const r = results.get(round)!;
        return new QueryRoundResult({
          round,
          protocolOverride: r.protocolOverride,
          error: r.error,
          calls: [...r.calls],
        });
      }),
    });
  }
}

/**
 * The events a stream of `response` would have had: what `RunQuery.stream`
 * reports when the node or the HTTP client answers in full. Each distinct
 * round once, in the order of the response, its calls' logs in one event each.
 *
 * @param response - The full answer.
 * @param effort - The answer's `X-Algod-Effort` header, if any.
 */
export function queryStreamEventsOf(
  response: QueryResponse,
  effort?: string
): QueryStreamEvent[] {
  const events: QueryStreamEvent[] = [
    {
      type: 'start',
      lastRound: response.lastRound,
      rounds: response.rounds.map((r) => r.round),
    },
  ];
  const seen = new Set<bigint>();
  for (const result of response.rounds) {
    if (!seen.has(result.round)) {
      seen.add(result.round);
      if (result.error === undefined) {
        result.calls.forEach((call, i) => {
          const logs = call.logs ?? [];
          if (logs.length > 0) {
            events.push({
              type: 'logs',
              round: result.round,
              call: i,
              index: 0,
              logs,
            });
          }
          events.push({
            type: 'call',
            round: result.round,
            call: i,
            logs: logs.length,
            cost: call.cost,
            ...(call.error !== undefined ? { error: call.error } : {}),
          });
        });
      }
      const end: QueryStreamRoundEvent = { type: 'round', round: result.round };
      if (result.protocolOverride)
        end.protocolOverride = result.protocolOverride;
      if (result.error !== undefined) end.error = result.error;
      events.push(end);
    }
  }
  events.push(effort !== undefined ? { type: 'end', effort } : { type: 'end' });
  return events;
}
