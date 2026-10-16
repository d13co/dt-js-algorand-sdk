import { HTTPClientResponse } from '../../../client.js';
import { ensureBigInt } from '../../../../utils/utils.js';
import IntDecoding from '../../../../types/intDecoding.js';

/**
 * Thrown when a node cannot answer a time-travel request: it has no
 * `/versions` endpoints, it rejected a past round, or it answered a read for a
 * round other than the one asked for, which is what stock algod does when it
 * ignores `round`.
 */
export class TimeTravelUnsupportedError extends Error {
  /** The round that was asked for, when the error comes from a round check. */
  public requestedRound?: bigint;

  /** The round the node answered for, when it reported one. */
  public returnedRound?: bigint;

  /** The HTTP error the node answered with, if any. */
  public cause?: unknown;

  constructor(
    message: string,
    {
      requestedRound,
      returnedRound,
      cause,
    }: { requestedRound?: bigint; returnedRound?: bigint; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'TimeTravelUnsupportedError';
    this.requestedRound = requestedRound;
    this.returnedRound = returnedRound;
    this.cause = cause;
  }
}

/**
 * Whether a JSON response has `key` at its top level. Decoding into a model
 * fills in 0 for a missing round, so a returned round of 0 needs this.
 */
function hasKey(response: HTTPClientResponse, key: string) {
  const body = response.parseBodyAsJSON({ intDecoding: IntDecoding.BIGINT });
  return typeof body === 'object' && body !== null && key in body;
}

/**
 * Throws a {@link TimeTravelUnsupportedError} if a round was requested and the
 * response is for a different round (or reports none).
 * @param requested - The round that was asked for, if any.
 * @param returned - The round reported by the decoded response.
 * @param response - The response, to tell a round of 0 from a missing one.
 * @param key - The response's round key: `round`, or `current_round`.
 */
export function checkRound(
  requested: bigint | undefined,
  returned: number | bigint | undefined,
  response: HTTPClientResponse,
  key = 'round'
) {
  if (requested === undefined) return;
  let returnedRound =
    returned === undefined ? undefined : ensureBigInt(returned);
  if (returnedRound === BigInt(0) && !hasKey(response, key)) {
    returnedRound = undefined;
  }
  if (returnedRound !== requested) {
    throw new TimeTravelUnsupportedError(
      `Asked for round ${requested} but the node answered for ${returnedRound ?? 'an unknown round'}; it does not support reads at past rounds`,
      { requestedRound: requested, returnedRound }
    );
  }
}

/** The status and the text of an error thrown by HTTPClient. */
function describe(err: unknown) {
  const e = err as
    | { status?: number; message?: string; response?: { text?: string } }
    | undefined;
  return {
    status: e?.status,
    text: `${e?.message ?? ''} ${e?.response?.text ?? ''}`,
  };
}

/**
 * Whether an error thrown by HTTPClient for a `/versions` request means the
 * node does not have them. That is a 404 (the routes are only registered with
 * `EnableTimeTravel`), or a 400 where:
 * - stock algod's router hands `{id}/versions` to the plain lookup as the ID
 *   (`/v2/assets/{id}`, `/v2/accounts/{address}/assets/{id}`,
 *   `.../applications/{id}`), which rejects it, or
 * - the node's ledger has no history (`versions require EnableTimeTravel`).
 */
export function isMissingVersionsRoute(err: unknown) {
  const { status, text } = describe(err);
  if (status === 404) return true;
  if (status !== 400) return false;
  // Only the router's ID binding error: a node with time travel rejects a bad
  // `next` with the same `parsing "...": invalid syntax` tail.
  return (
    /Invalid format for parameter (?:asset-id|application-id): .*parsing \\?"[^"\\]*\/versions\\?": invalid syntax/.test(
      text
    ) || /versions require EnableTimeTravel/.test(text)
  );
}

/**
 * Whether an error thrown by HTTPClient for a read with `round` means the node
 * cannot read past rounds. That is a 400 with either:
 * - `looking up past rounds requires EnableTimeTravel`, from a time-travel
 *   build with it off, or
 * - `given round is no longer available`, from a node that keeps only its last
 *   few rounds.
 */
export function isPastRoundUnsupported(err: unknown) {
  const { status, text } = describe(err);
  return (
    status === 400 &&
    /requires EnableTimeTravel|given round is no longer available/.test(text)
  );
}

/**
 * Runs a read, turning a refusal to read a past round into a
 * {@link TimeTravelUnsupportedError}.
 * @param requested - The round that was asked for, if any.
 * @param request - The read.
 */
export async function readAtRound(
  requested: bigint | undefined,
  request: Promise<HTTPClientResponse>
) {
  try {
    return await request;
  } catch (err) {
    if (requested !== undefined && isPastRoundUnsupported(err)) {
      throw new TimeTravelUnsupportedError(
        `The node cannot read round ${requested}; it does not support reads at past rounds`,
        { requestedRound: requested, cause: err }
      );
    }
    throw err;
  }
}
