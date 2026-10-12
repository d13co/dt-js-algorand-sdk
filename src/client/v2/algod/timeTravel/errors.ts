import { ensureBigInt } from '../../../../utils/utils.js';

/**
 * Thrown when a node cannot answer a time-travel request: it has no
 * `/versions` endpoints (404), or it answered a read for a round other than
 * the one asked for, which is what stock algod does when it ignores `round`.
 */
export class TimeTravelUnsupportedError extends Error {
  /** The round that was asked for, when the error comes from a round check. */
  public requestedRound?: bigint;

  /** The round the node answered for, when it reported one. */
  public returnedRound?: bigint;

  constructor(
    message: string,
    {
      requestedRound,
      returnedRound,
    }: { requestedRound?: bigint; returnedRound?: bigint } = {}
  ) {
    super(message);
    this.name = 'TimeTravelUnsupportedError';
    this.requestedRound = requestedRound;
    this.returnedRound = returnedRound;
  }
}

/**
 * Throws a {@link TimeTravelUnsupportedError} if a round was requested and the
 * response is for a different round (or reports none).
 * @param requested - The round that was asked for, if any.
 * @param returned - The round reported by the response.
 */
export function checkRound(
  requested: bigint | undefined,
  returned: number | bigint | undefined
) {
  if (requested === undefined) return;
  const returnedRound =
    returned === undefined ? undefined : ensureBigInt(returned);
  if (returnedRound !== requested) {
    throw new TimeTravelUnsupportedError(
      `Asked for round ${requested} but the node answered for ${returnedRound ?? 'an unknown round'}; it does not support reads at past rounds`,
      { requestedRound: requested, returnedRound }
    );
  }
}

/**
 * Whether an error thrown by HTTPClient is an HTTP 404.
 */
export function isNotFound(err: unknown) {
  return (err as { status?: number } | undefined)?.status === 404;
}
