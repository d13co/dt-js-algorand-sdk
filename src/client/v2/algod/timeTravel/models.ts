/**
 * Models for the time-travel algod endpoints (tag `timetravel` in the
 * time-travel build's algod.oas2.json). They follow the style of the generated
 * `../models/types.ts`, but live here so that file can be regenerated from
 * upstream's spec.
 */

/* eslint-disable no-use-before-define */
import { ensureBigInt, ensureSafeInteger } from '../../../../utils/utils.js';
import { Encodable, Schema } from '../../../../encoding/encoding.js';
import {
  NamedMapSchema,
  ArraySchema,
  Uint64Schema,
  StringSchema,
  BooleanSchema,
  ByteArraySchema,
  OptionalSchema,
} from '../../../../encoding/schema/index.js';
import { base64ToBytes } from '../../../../encoding/binarydata.js';

/**
 * A version of a box.
 */
export class BoxVersion implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'timestamp', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'deleted', valueSchema: new BooleanSchema(), omitEmpty: true },
        {
          key: 'value',
          valueSchema: new OptionalSchema(new ByteArraySchema()),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The round of the version.
   */
  public round: bigint;

  /**
   * The timestamp of the version's block, in seconds since the epoch.
   */
  public timestamp: number;

  /**
   * Whether the version is the deletion of the box.
   */
  public deleted: boolean;

  /**
   * With `include=values`, the new box value. Absent on deletions.
   */
  public value?: Uint8Array;

  /**
   * Creates a new `BoxVersion` object.
   * @param round - The round of the version.
   * @param timestamp - The timestamp of the version's block, in seconds since the epoch.
   * @param deleted - Whether the version is the deletion of the box.
   * @param value - With `include=values`, the new box value. Absent on deletions.
   */
  constructor({
    round,
    timestamp,
    deleted,
    value,
  }: {
    round: number | bigint;
    timestamp: number | bigint;
    deleted: boolean;
    value?: string | Uint8Array;
  }) {
    this.round = ensureBigInt(round);
    this.timestamp = ensureSafeInteger(timestamp);
    this.deleted = deleted;
    this.value = typeof value === 'string' ? base64ToBytes(value) : value;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return BoxVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['timestamp', this.timestamp],
      ['deleted', this.deleted],
      ['value', this.value],
    ]);
  }

  static fromEncodingData(data: unknown): BoxVersion {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded BoxVersion: ${data}`);
    }
    return new BoxVersion({
      round: data.get('round'),
      timestamp: data.get('timestamp'),
      deleted: data.get('deleted'),
      value: data.get('value'),
    });
  }
}

/**
 * Versions of a box.
 */
export class BoxVersionsResponse implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'versions',
          valueSchema: new ArraySchema(BoxVersion.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'next-token',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The last round of the range: `max-round`, or the latest round. On a
   * descending page resumed from `next`, the round in the token.
   */
  public round: bigint;

  public versions: BoxVersion[];

  /**
   * Present if and only if more versions remain: provide it as the `next`
   * parameter to get them.
   */
  public nextToken?: string;

  /**
   * Creates a new `BoxVersionsResponse` object.
   * @param round - The last round of the range: `max-round`, or the latest round.
   * @param versions -
   * @param nextToken - Present if and only if more versions remain.
   */
  constructor({
    round,
    versions,
    nextToken,
  }: {
    round: number | bigint;
    versions: BoxVersion[];
    nextToken?: string;
  }) {
    this.round = ensureBigInt(round);
    this.versions = versions;
    this.nextToken = nextToken;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return BoxVersionsResponse.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['versions', this.versions.map((v) => v.toEncodingData())],
      ['next-token', this.nextToken],
    ]);
  }

  static fromEncodingData(data: unknown): BoxVersionsResponse {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded BoxVersionsResponse: ${data}`);
    }
    return new BoxVersionsResponse({
      round: data.get('round'),
      versions: (data.get('versions') ?? []).map((v: unknown) =>
        BoxVersion.fromEncodingData(v)
      ),
      nextToken: data.get('next-token'),
    });
  }
}
