/**
 * Models for the time-travel algod endpoints (tag `timetravel` in the
 * time-travel build's algod.oas2.json). They follow the style of the generated
 * `../models/types.ts`, but live here so that file can be regenerated from
 * upstream's spec.
 */

/* eslint-disable no-use-before-define */
import {
  ensureBigInt,
  ensureSafeInteger,
  ensureUint64,
} from '../../../../utils/utils.js';
import {
  Encodable,
  Schema,
  MsgpackEncodingData,
  MsgpackRawStringProvider,
  JSONEncodingData,
} from '../../../../encoding/encoding.js';
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
import {
  Account,
  AccountParticipation,
  Application,
  ApplicationLocalState,
  ApplicationParams,
  ApplicationStateSchema,
  Asset,
  AssetHolding,
  AssetParams,
  BoxReference,
  SimulateRequest,
  SimulateRequestTransactionGroup,
  SimulateResponse,
  SimulateTransactionGroupResult,
  SimulationTransactionExecTrace,
  TealValue,
} from '../models/types.js';
import { Address } from '../../../../encoding/address.js';
import { Transaction } from '../../../../transaction.js';
import { SignedTransaction } from '../../../../signedTransaction.js';
import { assignGroupID } from '../../../../group.js';
import { SimulateGroupError } from './errors.js';

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
          key: 'changed-round',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
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
   * The round of the version, or with `rounds` the requested round.
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
   * With `rounds`: the round of the version in effect at the requested round,
   * the latest change at or before it. Absent if there was none: the object did
   * not exist yet, and `deleted` is then true.
   */
  public changedRound?: bigint;

  /**
   * With `include=values`, the new box value. Absent on deletions.
   */
  public value?: Uint8Array;

  /**
   * Creates a new `BoxVersion` object.
   * @param round - The round of the version.
   * @param timestamp - The timestamp of the version's block, in seconds since the epoch.
   * @param deleted - Whether the version is the deletion of the box.
   * @param changedRound - With `rounds`: the round of the change in effect at the requested round.
   * @param value - With `include=values`, the new box value. Absent on deletions.
   */
  constructor({
    round,
    timestamp,
    deleted,
    changedRound,
    value,
  }: {
    round: number | bigint;
    timestamp: number | bigint;
    deleted: boolean;
    changedRound?: number | bigint;
    value?: string | Uint8Array;
  }) {
    this.round = ensureBigInt(round);
    this.timestamp = ensureSafeInteger(timestamp);
    this.deleted = deleted;
    this.changedRound =
      typeof changedRound === 'undefined'
        ? undefined
        : ensureBigInt(changedRound);
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
      ['changed-round', this.changedRound],
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
      changedRound: data.get('changed-round'),
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
   * descending page resumed from `next`, the round in the token. With
   * `rounds`, the largest requested round not listed by an earlier page.
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

/**
 * A change of a box.
 */
export class BoxChange implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'name', valueSchema: new ByteArraySchema(), omitEmpty: true },
        { key: 'deleted', valueSchema: new BooleanSchema(), omitEmpty: true },
        {
          key: 'changed-round',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
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
   * The box name.
   */
  public name: Uint8Array;

  /**
   * Whether the change is the deletion of the box.
   */
  public deleted: boolean;

  /**
   * With `rounds`: the round of the latest change at or before the requested
   * round.
   */
  public changedRound?: bigint;

  /**
   * With `include=values`, the new box value. Absent on deletions.
   */
  public value?: Uint8Array;

  /**
   * Creates a new `BoxChange` object.
   * @param name - The box name.
   * @param deleted - Whether the change is the deletion of the box.
   * @param changedRound - With `rounds`: the round of the change in effect at the requested round.
   * @param value - With `include=values`, the new box value. Absent on deletions.
   */
  constructor({
    name,
    deleted,
    changedRound,
    value,
  }: {
    name: string | Uint8Array;
    deleted: boolean;
    changedRound?: number | bigint;
    value?: string | Uint8Array;
  }) {
    this.name = typeof name === 'string' ? base64ToBytes(name) : name;
    this.deleted = deleted;
    this.changedRound =
      typeof changedRound === 'undefined'
        ? undefined
        : ensureBigInt(changedRound);
    this.value = typeof value === 'string' ? base64ToBytes(value) : value;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return BoxChange.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['name', this.name],
      ['deleted', this.deleted],
      ['changed-round', this.changedRound],
      ['value', this.value],
    ]);
  }

  static fromEncodingData(data: unknown): BoxChange {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded BoxChange: ${data}`);
    }
    return new BoxChange({
      name: data.get('name'),
      deleted: data.get('deleted'),
      changedRound: data.get('changed-round'),
      value: data.get('value'),
    });
  }
}

/**
 * The changes of an application's boxes in a round.
 */
export class BoxesVersion implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'timestamp', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'boxes',
          valueSchema: new ArraySchema(BoxChange.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The round of the version, or with `rounds` the requested round.
   */
  public round: bigint;

  /**
   * The timestamp of the version's block, in seconds since the epoch.
   */
  public timestamp: number;

  /**
   * The boxes that changed, in name order.
   */
  public boxes: BoxChange[];

  /**
   * Creates a new `BoxesVersion` object.
   * @param round - The round of the version.
   * @param timestamp - The timestamp of the version's block, in seconds since the epoch.
   * @param boxes - The boxes that changed, in name order.
   */
  constructor({
    round,
    timestamp,
    boxes,
  }: {
    round: number | bigint;
    timestamp: number | bigint;
    boxes: BoxChange[];
  }) {
    this.round = ensureBigInt(round);
    this.timestamp = ensureSafeInteger(timestamp);
    this.boxes = boxes;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return BoxesVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['timestamp', this.timestamp],
      ['boxes', this.boxes.map((b) => b.toEncodingData())],
    ]);
  }

  static fromEncodingData(data: unknown): BoxesVersion {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded BoxesVersion: ${data}`);
    }
    return new BoxesVersion({
      round: data.get('round'),
      timestamp: data.get('timestamp'),
      boxes: (data.get('boxes') ?? []).map((b: unknown) =>
        BoxChange.fromEncodingData(b)
      ),
    });
  }
}

/**
 * Changes of an application's boxes.
 */
export class BoxesVersionsResponse implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'versions',
          valueSchema: new ArraySchema(BoxesVersion.encodingSchema),
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
   * descending page resumed from `next`, the round in the token. With
   * `rounds`, the largest requested round not listed by an earlier page.
   */
  public round: bigint;

  public versions: BoxesVersion[];

  /**
   * Present if and only if more versions remain: provide it as the `next`
   * parameter to get them.
   */
  public nextToken?: string;

  /**
   * Creates a new `BoxesVersionsResponse` object.
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
    versions: BoxesVersion[];
    nextToken?: string;
  }) {
    this.round = ensureBigInt(round);
    this.versions = versions;
    this.nextToken = nextToken;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return BoxesVersionsResponse.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['versions', this.versions.map((v) => v.toEncodingData())],
      ['next-token', this.nextToken],
    ]);
  }

  static fromEncodingData(data: unknown): BoxesVersionsResponse {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded BoxesVersionsResponse: ${data}`);
    }
    return new BoxesVersionsResponse({
      round: data.get('round'),
      versions: (data.get('versions') ?? []).map((v: unknown) =>
        BoxesVersion.fromEncodingData(v)
      ),
      nextToken: data.get('next-token'),
    });
  }
}

/**
 * A version of an asset's parameters.
 */
export class AssetVersion implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'timestamp', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'deleted', valueSchema: new BooleanSchema(), omitEmpty: true },
        {
          key: 'changed-round',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'asset',
          valueSchema: new OptionalSchema(Asset.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The round of the version, or with `rounds` the requested round.
   */
  public round: bigint;

  /**
   * The timestamp of the version's block, in seconds since the epoch.
   */
  public timestamp: number;

  /**
   * Whether the version is the deletion of the asset.
   */
  public deleted: boolean;

  /**
   * With `rounds`: the round of the version in effect at the requested round,
   * the latest change at or before it. Absent if there was none: the object did
   * not exist yet, and `deleted` is then true.
   */
  public changedRound?: bigint;

  /**
   * With `include=values`, the new asset parameters. Absent on deletions.
   */
  public asset?: Asset;

  /**
   * Creates a new `AssetVersion` object.
   * @param round - The round of the version.
   * @param timestamp - The timestamp of the version's block, in seconds since the epoch.
   * @param deleted - Whether the version is the deletion of the asset.
   * @param changedRound - With `rounds`: the round of the change in effect at the requested round.
   * @param asset - With `include=values`, the new asset parameters. Absent on deletions.
   */
  constructor({
    round,
    timestamp,
    deleted,
    changedRound,
    asset,
  }: {
    round: number | bigint;
    timestamp: number | bigint;
    deleted: boolean;
    changedRound?: number | bigint;
    asset?: Asset;
  }) {
    this.round = ensureBigInt(round);
    this.timestamp = ensureSafeInteger(timestamp);
    this.deleted = deleted;
    this.changedRound =
      typeof changedRound === 'undefined'
        ? undefined
        : ensureBigInt(changedRound);
    this.asset = asset;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AssetVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['timestamp', this.timestamp],
      ['deleted', this.deleted],
      ['changed-round', this.changedRound],
      [
        'asset',
        typeof this.asset !== 'undefined'
          ? this.asset.toEncodingData()
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): AssetVersion {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AssetVersion: ${data}`);
    }
    return new AssetVersion({
      round: data.get('round'),
      timestamp: data.get('timestamp'),
      deleted: data.get('deleted'),
      changedRound: data.get('changed-round'),
      asset:
        typeof data.get('asset') !== 'undefined'
          ? Asset.fromEncodingData(data.get('asset'))
          : undefined,
    });
  }
}

/**
 * Versions of an asset.
 */
export class AssetVersionsResponse implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'versions',
          valueSchema: new ArraySchema(AssetVersion.encodingSchema),
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
   * descending page resumed from `next`, the round in the token. With
   * `rounds`, the largest requested round not listed by an earlier page.
   */
  public round: bigint;

  public versions: AssetVersion[];

  /**
   * Present if and only if more versions remain: provide it as the `next`
   * parameter to get them.
   */
  public nextToken?: string;

  /**
   * Creates a new `AssetVersionsResponse` object.
   * @param round - The last round of the range: `max-round`, or the latest round. On a
   * @param versions -
   * @param nextToken - Present if and only if more versions remain: provide it as the `next`
   */
  constructor({
    round,
    versions,
    nextToken,
  }: {
    round: number | bigint;
    versions: AssetVersion[];
    nextToken?: string;
  }) {
    this.round = ensureBigInt(round);
    this.versions = versions;
    this.nextToken = nextToken;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AssetVersionsResponse.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['versions', this.versions.map((v) => v.toEncodingData())],
      ['next-token', this.nextToken],
    ]);
  }

  static fromEncodingData(data: unknown): AssetVersionsResponse {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AssetVersionsResponse: ${data}`);
    }
    return new AssetVersionsResponse({
      round: data.get('round'),
      versions: (data.get('versions') ?? []).map((v: unknown) =>
        AssetVersion.fromEncodingData(v)
      ),
      nextToken: data.get('next-token'),
    });
  }
}

/**
 * A version of an application's parameters.
 */
export class ApplicationVersion implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'timestamp', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'deleted', valueSchema: new BooleanSchema(), omitEmpty: true },
        {
          key: 'changed-round',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'application',
          valueSchema: new OptionalSchema(Application.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'changed-keys',
          valueSchema: new OptionalSchema(
            new ArraySchema(new ByteArraySchema())
          ),
          omitEmpty: true,
        },
        {
          key: 'key-value',
          valueSchema: new OptionalSchema(TealValue.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The round of the version, or with `rounds` the requested round.
   */
  public round: bigint;

  /**
   * The timestamp of the version's block, in seconds since the epoch.
   */
  public timestamp: number;

  /**
   * Whether the version is the deletion of the application.
   */
  public deleted: boolean;

  /**
   * With `rounds`: the round of the version in effect at the requested round,
   * the latest change at or before it. Absent if there was none: the object did
   * not exist yet, and `deleted` is then true.
   */
  public changedRound?: bigint;

  /**
   * With `include=values`, the new application parameters. Absent on deletions.
   */
  public application?: Application;

  /**
   * With `include('keys')`, the global state keys added, removed or changed in
   * this round, sorted: net over the round, so a key set and deleted again
   * within it is not listed. On creation, every key of the new state. Empty
   * when only other parameters changed. Absent on deletions.
   */
  public changedKeys?: Uint8Array[];

  /**
   * With `key()`, the key's new value. Absent when the version removed the key or deleted the application.
   */
  public keyValue?: TealValue;

  /**
   * Creates a new `ApplicationVersion` object.
   * @param round - The round of the version.
   * @param timestamp - The timestamp of the version's block, in seconds since the epoch.
   * @param deleted - Whether the version is the deletion of the application.
   * @param changedRound - With `rounds`: the round of the change in effect at the requested round.
   * @param application - With `include=values`, the new application parameters. Absent on deletions.
   * @param changedKeys - With `include('keys')`, the state keys that changed in this round.
   * @param keyValue - With `key()`, the key's new value.
   */
  constructor({
    round,
    timestamp,
    deleted,
    changedRound,
    application,
    changedKeys,
    keyValue,
  }: {
    round: number | bigint;
    timestamp: number | bigint;
    deleted: boolean;
    changedRound?: number | bigint;
    application?: Application;
    changedKeys?: (string | Uint8Array)[];
    keyValue?: TealValue;
  }) {
    this.round = ensureBigInt(round);
    this.timestamp = ensureSafeInteger(timestamp);
    this.deleted = deleted;
    this.changedRound =
      typeof changedRound === 'undefined'
        ? undefined
        : ensureBigInt(changedRound);
    this.application = application;
    this.changedKeys =
      typeof changedKeys === 'undefined'
        ? undefined
        : changedKeys.map((k) =>
            typeof k === 'string' ? base64ToBytes(k) : k
          );
    this.keyValue = keyValue;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return ApplicationVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['timestamp', this.timestamp],
      ['deleted', this.deleted],
      ['changed-round', this.changedRound],
      [
        'application',
        typeof this.application !== 'undefined'
          ? this.application.toEncodingData()
          : undefined,
      ],
      ['changed-keys', this.changedKeys],
      [
        'key-value',
        typeof this.keyValue !== 'undefined'
          ? this.keyValue.toEncodingData()
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): ApplicationVersion {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded ApplicationVersion: ${data}`);
    }
    return new ApplicationVersion({
      round: data.get('round'),
      timestamp: data.get('timestamp'),
      deleted: data.get('deleted'),
      changedRound: data.get('changed-round'),
      application:
        typeof data.get('application') !== 'undefined'
          ? Application.fromEncodingData(data.get('application'))
          : undefined,
      changedKeys: data.get('changed-keys'),
      keyValue:
        typeof data.get('key-value') !== 'undefined'
          ? TealValue.fromEncodingData(data.get('key-value'))
          : undefined,
    });
  }
}

/**
 * Versions of an application.
 */
export class ApplicationVersionsResponse implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'versions',
          valueSchema: new ArraySchema(ApplicationVersion.encodingSchema),
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
   * descending page resumed from `next`, the round in the token. With
   * `rounds`, the largest requested round not listed by an earlier page.
   */
  public round: bigint;

  public versions: ApplicationVersion[];

  /**
   * Present if and only if more versions remain: provide it as the `next`
   * parameter to get them.
   */
  public nextToken?: string;

  /**
   * Creates a new `ApplicationVersionsResponse` object.
   * @param round - The last round of the range: `max-round`, or the latest round. On a
   * @param versions -
   * @param nextToken - Present if and only if more versions remain: provide it as the `next`
   */
  constructor({
    round,
    versions,
    nextToken,
  }: {
    round: number | bigint;
    versions: ApplicationVersion[];
    nextToken?: string;
  }) {
    this.round = ensureBigInt(round);
    this.versions = versions;
    this.nextToken = nextToken;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return ApplicationVersionsResponse.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['versions', this.versions.map((v) => v.toEncodingData())],
      ['next-token', this.nextToken],
    ]);
  }

  static fromEncodingData(data: unknown): ApplicationVersionsResponse {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded ApplicationVersionsResponse: ${data}`);
    }
    return new ApplicationVersionsResponse({
      round: data.get('round'),
      versions: (data.get('versions') ?? []).map((v: unknown) =>
        ApplicationVersion.fromEncodingData(v)
      ),
      nextToken: data.get('next-token'),
    });
  }
}

/**
 * The objects of an account that changed in a round. Lists that did not
 * change are omitted.
 */
export class AccountVersion implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'timestamp', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'base',
          valueSchema: new OptionalSchema(AccountBaseVersion.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'assets',
          valueSchema: new OptionalSchema(
            new ArraySchema(AssetHoldingVersion.encodingSchema)
          ),
          omitEmpty: true,
        },
        {
          key: 'apps-local-state',
          valueSchema: new OptionalSchema(
            new ArraySchema(ApplicationLocalStateVersion.encodingSchema)
          ),
          omitEmpty: true,
        },
        {
          key: 'created-assets',
          valueSchema: new OptionalSchema(
            new ArraySchema(CreatedAssetVersion.encodingSchema)
          ),
          omitEmpty: true,
        },
        {
          key: 'created-apps',
          valueSchema: new OptionalSchema(
            new ArraySchema(CreatedApplicationVersion.encodingSchema)
          ),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The round of the version, or with `rounds` the requested round.
   */
  public round: bigint;

  /**
   * The timestamp of the version's block, in seconds since the epoch.
   */
  public timestamp: number;

  /**
   * Present if the account's base record changed.
   */
  public base?: AccountBaseVersion;

  /**
   * The asset holdings that changed.
   */
  public assets?: AssetHoldingVersion[];

  /**
   * The application local states that changed.
   */
  public appsLocalState?: ApplicationLocalStateVersion[];

  /**
   * The created assets whose parameters changed, or, with
   * `exclude=created-assets-params`, that were created or destroyed.
   */
  public createdAssets?: CreatedAssetVersion[];

  /**
   * The created applications whose parameters changed, or, with
   * `exclude=created-apps-params`, that were created or deleted.
   */
  public createdApps?: CreatedApplicationVersion[];

  /**
   * Creates a new `AccountVersion` object.
   * @param round - The round of the version.
   * @param timestamp - The timestamp of the version's block, in seconds since the epoch.
   * @param base - Present if the account's base record changed.
   * @param assets - The asset holdings that changed.
   * @param appsLocalState - The application local states that changed.
   * @param createdAssets - The created assets whose parameters changed, or, with
   * @param createdApps - The created applications whose parameters changed, or, with
   */
  constructor({
    round,
    timestamp,
    base,
    assets,
    appsLocalState,
    createdAssets,
    createdApps,
  }: {
    round: number | bigint;
    timestamp: number | bigint;
    base?: AccountBaseVersion;
    assets?: AssetHoldingVersion[];
    appsLocalState?: ApplicationLocalStateVersion[];
    createdAssets?: CreatedAssetVersion[];
    createdApps?: CreatedApplicationVersion[];
  }) {
    this.round = ensureBigInt(round);
    this.timestamp = ensureSafeInteger(timestamp);
    this.base = base;
    this.assets = assets;
    this.appsLocalState = appsLocalState;
    this.createdAssets = createdAssets;
    this.createdApps = createdApps;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AccountVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['timestamp', this.timestamp],
      [
        'base',
        typeof this.base !== 'undefined'
          ? this.base.toEncodingData()
          : undefined,
      ],
      [
        'assets',
        typeof this.assets !== 'undefined'
          ? this.assets.map((v) => v.toEncodingData())
          : undefined,
      ],
      [
        'apps-local-state',
        typeof this.appsLocalState !== 'undefined'
          ? this.appsLocalState.map((v) => v.toEncodingData())
          : undefined,
      ],
      [
        'created-assets',
        typeof this.createdAssets !== 'undefined'
          ? this.createdAssets.map((v) => v.toEncodingData())
          : undefined,
      ],
      [
        'created-apps',
        typeof this.createdApps !== 'undefined'
          ? this.createdApps.map((v) => v.toEncodingData())
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): AccountVersion {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AccountVersion: ${data}`);
    }
    return new AccountVersion({
      round: data.get('round'),
      timestamp: data.get('timestamp'),
      base:
        typeof data.get('base') !== 'undefined'
          ? AccountBaseVersion.fromEncodingData(data.get('base'))
          : undefined,
      assets:
        typeof data.get('assets') !== 'undefined'
          ? data
              .get('assets')
              .map((v: unknown) => AssetHoldingVersion.fromEncodingData(v))
          : undefined,
      appsLocalState:
        typeof data.get('apps-local-state') !== 'undefined'
          ? data
              .get('apps-local-state')
              .map((v: unknown) =>
                ApplicationLocalStateVersion.fromEncodingData(v)
              )
          : undefined,
      createdAssets:
        typeof data.get('created-assets') !== 'undefined'
          ? data
              .get('created-assets')
              .map((v: unknown) => CreatedAssetVersion.fromEncodingData(v))
          : undefined,
      createdApps:
        typeof data.get('created-apps') !== 'undefined'
          ? data
              .get('created-apps')
              .map((v: unknown) =>
                CreatedApplicationVersion.fromEncodingData(v)
              )
          : undefined,
    });
  }
}

/**
 * A version of an account's base record.
 */
export class AccountBaseVersion implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'deleted', valueSchema: new BooleanSchema(), omitEmpty: true },
        {
          key: 'changed-round',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'account',
          valueSchema: new OptionalSchema(Account.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * Whether the account was closed.
   */
  public deleted: boolean;

  /**
   * With `rounds`: the round of the version in effect at the requested round,
   * the latest change at or before it. Absent if there was none: the object did
   * not exist yet, and `deleted` is then true.
   */
  public changedRound?: bigint;

  /**
   * With `include=values`, the account as of the version's round, without its
   * assets and applications, as `accountInformation(address).exclude('all')`
   * returns it at that round.
   */
  public account?: Account;

  /**
   * Creates a new `AccountBaseVersion` object.
   * @param deleted - Whether the account was closed.
   * @param changedRound - With `rounds`: the round of the change in effect at the requested round.
   * @param account - With `include=values`, the account as of the version's round, without its
   */
  constructor({
    deleted,
    changedRound,
    account,
  }: {
    deleted: boolean;
    changedRound?: number | bigint;
    account?: Account;
  }) {
    this.deleted = deleted;
    this.changedRound =
      typeof changedRound === 'undefined'
        ? undefined
        : ensureBigInt(changedRound);
    this.account = account;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AccountBaseVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['deleted', this.deleted],
      ['changed-round', this.changedRound],
      [
        'account',
        typeof this.account !== 'undefined'
          ? this.account.toEncodingData()
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): AccountBaseVersion {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AccountBaseVersion: ${data}`);
    }
    return new AccountBaseVersion({
      deleted: data.get('deleted'),
      changedRound: data.get('changed-round'),
      account:
        typeof data.get('account') !== 'undefined'
          ? Account.fromEncodingData(data.get('account'))
          : undefined,
    });
  }
}

/**
 * A version of an asset holding.
 */
export class AssetHoldingVersion implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'asset-id', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'deleted', valueSchema: new BooleanSchema(), omitEmpty: true },
        {
          key: 'changed-round',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'asset-holding',
          valueSchema: new OptionalSchema(AssetHolding.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The asset.
   */
  public assetId: bigint;

  /**
   * Whether the version is the deletion of the holding (opt out).
   */
  public deleted: boolean;

  /**
   * With `rounds`: the round of the latest change at or before the requested
   * round.
   */
  public changedRound?: bigint;

  /**
   * With `include=values`, the new holding.
   */
  public assetHolding?: AssetHolding;

  /**
   * Creates a new `AssetHoldingVersion` object.
   * @param assetId - The asset.
   * @param deleted - Whether the version is the deletion of the holding (opt out).
   * @param changedRound - With `rounds`: the round of the change in effect at the requested round.
   * @param assetHolding - With `include=values`, the new holding.
   */
  constructor({
    assetId,
    deleted,
    changedRound,
    assetHolding,
  }: {
    assetId: number | bigint;
    deleted: boolean;
    changedRound?: number | bigint;
    assetHolding?: AssetHolding;
  }) {
    this.assetId = ensureBigInt(assetId);
    this.deleted = deleted;
    this.changedRound =
      typeof changedRound === 'undefined'
        ? undefined
        : ensureBigInt(changedRound);
    this.assetHolding = assetHolding;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AssetHoldingVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['asset-id', this.assetId],
      ['deleted', this.deleted],
      ['changed-round', this.changedRound],
      [
        'asset-holding',
        typeof this.assetHolding !== 'undefined'
          ? this.assetHolding.toEncodingData()
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): AssetHoldingVersion {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AssetHoldingVersion: ${data}`);
    }
    return new AssetHoldingVersion({
      assetId: data.get('asset-id'),
      deleted: data.get('deleted'),
      changedRound: data.get('changed-round'),
      assetHolding:
        typeof data.get('asset-holding') !== 'undefined'
          ? AssetHolding.fromEncodingData(data.get('asset-holding'))
          : undefined,
    });
  }
}

/**
 * A version of an application local state.
 */
export class ApplicationLocalStateVersion implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'app-id', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'deleted', valueSchema: new BooleanSchema(), omitEmpty: true },
        {
          key: 'changed-round',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'app-local-state',
          valueSchema: new OptionalSchema(ApplicationLocalState.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'changed-keys',
          valueSchema: new OptionalSchema(
            new ArraySchema(new ByteArraySchema())
          ),
          omitEmpty: true,
        },
        {
          key: 'key-value',
          valueSchema: new OptionalSchema(TealValue.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The application.
   */
  public appId: bigint;

  /**
   * Whether the version is the deletion of the local state (close out or
   * clear).
   */
  public deleted: boolean;

  /**
   * With `rounds`: the round of the latest change at or before the requested
   * round.
   */
  public changedRound?: bigint;

  /**
   * With `include=values`, the new local state.
   */
  public appLocalState?: ApplicationLocalState;

  /**
   * With `include('keys')`, the local state keys added, removed or changed in
   * this round, sorted. On an opt-in after no local state, every key of the new
   * state; on a clear and opt-in in the same round, the keys that differ.
   * Absent on deletions.
   */
  public changedKeys?: Uint8Array[];

  /**
   * With `key()`, the key's new value. Absent when the version removed the key or deleted the local state.
   */
  public keyValue?: TealValue;

  /**
   * Creates a new `ApplicationLocalStateVersion` object.
   * @param appId - The application.
   * @param deleted - Whether the version is the deletion of the local state (close out or
   * @param changedRound - With `rounds`: the round of the change in effect at the requested round.
   * @param appLocalState - With `include=values`, the new local state.
   * @param changedKeys - With `include('keys')`, the state keys that changed in this round.
   * @param keyValue - With `key()`, the key's new value.
   */
  constructor({
    appId,
    deleted,
    changedRound,
    appLocalState,
    changedKeys,
    keyValue,
  }: {
    appId: number | bigint;
    deleted: boolean;
    changedRound?: number | bigint;
    appLocalState?: ApplicationLocalState;
    changedKeys?: (string | Uint8Array)[];
    keyValue?: TealValue;
  }) {
    this.appId = ensureBigInt(appId);
    this.deleted = deleted;
    this.changedRound =
      typeof changedRound === 'undefined'
        ? undefined
        : ensureBigInt(changedRound);
    this.appLocalState = appLocalState;
    this.changedKeys =
      typeof changedKeys === 'undefined'
        ? undefined
        : changedKeys.map((k) =>
            typeof k === 'string' ? base64ToBytes(k) : k
          );
    this.keyValue = keyValue;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return ApplicationLocalStateVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['app-id', this.appId],
      ['deleted', this.deleted],
      ['changed-round', this.changedRound],
      [
        'app-local-state',
        typeof this.appLocalState !== 'undefined'
          ? this.appLocalState.toEncodingData()
          : undefined,
      ],
      ['changed-keys', this.changedKeys],
      [
        'key-value',
        typeof this.keyValue !== 'undefined'
          ? this.keyValue.toEncodingData()
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): ApplicationLocalStateVersion {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded ApplicationLocalStateVersion: ${data}`);
    }
    return new ApplicationLocalStateVersion({
      appId: data.get('app-id'),
      deleted: data.get('deleted'),
      changedRound: data.get('changed-round'),
      appLocalState:
        typeof data.get('app-local-state') !== 'undefined'
          ? ApplicationLocalState.fromEncodingData(data.get('app-local-state'))
          : undefined,
      changedKeys: data.get('changed-keys'),
      keyValue:
        typeof data.get('key-value') !== 'undefined'
          ? TealValue.fromEncodingData(data.get('key-value'))
          : undefined,
    });
  }
}

/**
 * A version of the parameters of an asset the account created.
 */
export class CreatedAssetVersion implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'asset-id', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'deleted', valueSchema: new BooleanSchema(), omitEmpty: true },
        {
          key: 'changed-round',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'asset',
          valueSchema: new OptionalSchema(Asset.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The asset.
   */
  public assetId: bigint;

  /**
   * Whether the version is the deletion of the asset.
   */
  public deleted: boolean;

  /**
   * With `rounds`: the round of the latest change at or before the requested
   * round.
   */
  public changedRound?: bigint;

  /**
   * With `include=values`, the new asset parameters.
   */
  public asset?: Asset;

  /**
   * Creates a new `CreatedAssetVersion` object.
   * @param assetId - The asset.
   * @param deleted - Whether the version is the deletion of the asset.
   * @param changedRound - With `rounds`: the round of the change in effect at the requested round.
   * @param asset - With `include=values`, the new asset parameters.
   */
  constructor({
    assetId,
    deleted,
    changedRound,
    asset,
  }: {
    assetId: number | bigint;
    deleted: boolean;
    changedRound?: number | bigint;
    asset?: Asset;
  }) {
    this.assetId = ensureBigInt(assetId);
    this.deleted = deleted;
    this.changedRound =
      typeof changedRound === 'undefined'
        ? undefined
        : ensureBigInt(changedRound);
    this.asset = asset;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return CreatedAssetVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['asset-id', this.assetId],
      ['deleted', this.deleted],
      ['changed-round', this.changedRound],
      [
        'asset',
        typeof this.asset !== 'undefined'
          ? this.asset.toEncodingData()
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): CreatedAssetVersion {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded CreatedAssetVersion: ${data}`);
    }
    return new CreatedAssetVersion({
      assetId: data.get('asset-id'),
      deleted: data.get('deleted'),
      changedRound: data.get('changed-round'),
      asset:
        typeof data.get('asset') !== 'undefined'
          ? Asset.fromEncodingData(data.get('asset'))
          : undefined,
    });
  }
}

/**
 * A version of the parameters of an application the account created.
 */
export class CreatedApplicationVersion implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'app-id', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'deleted', valueSchema: new BooleanSchema(), omitEmpty: true },
        {
          key: 'changed-round',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'application',
          valueSchema: new OptionalSchema(Application.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'changed-keys',
          valueSchema: new OptionalSchema(
            new ArraySchema(new ByteArraySchema())
          ),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The application.
   */
  public appId: bigint;

  /**
   * Whether the version is the deletion of the application.
   */
  public deleted: boolean;

  /**
   * With `rounds`: the round of the latest change at or before the requested
   * round.
   */
  public changedRound?: bigint;

  /**
   * With `include=values`, the new application parameters.
   */
  public application?: Application;

  /**
   * With `include('keys')`, the global state keys added, removed or changed in
   * this round, sorted. On creation, every key of the new state. Empty when
   * only other parameters changed. Absent on deletions and with
   * `exclude('created-apps-params')`.
   */
  public changedKeys?: Uint8Array[];

  /**
   * Creates a new `CreatedApplicationVersion` object.
   * @param appId - The application.
   * @param deleted - Whether the version is the deletion of the application.
   * @param changedRound - With `rounds`: the round of the change in effect at the requested round.
   * @param application - With `include=values`, the new application parameters.
   * @param changedKeys - With `include('keys')`, the state keys that changed in this round.
   */
  constructor({
    appId,
    deleted,
    changedRound,
    application,
    changedKeys,
  }: {
    appId: number | bigint;
    deleted: boolean;
    changedRound?: number | bigint;
    application?: Application;
    changedKeys?: (string | Uint8Array)[];
  }) {
    this.appId = ensureBigInt(appId);
    this.deleted = deleted;
    this.changedRound =
      typeof changedRound === 'undefined'
        ? undefined
        : ensureBigInt(changedRound);
    this.application = application;
    this.changedKeys =
      typeof changedKeys === 'undefined'
        ? undefined
        : changedKeys.map((k) =>
            typeof k === 'string' ? base64ToBytes(k) : k
          );
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return CreatedApplicationVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['app-id', this.appId],
      ['deleted', this.deleted],
      ['changed-round', this.changedRound],
      [
        'application',
        typeof this.application !== 'undefined'
          ? this.application.toEncodingData()
          : undefined,
      ],
      ['changed-keys', this.changedKeys],
    ]);
  }

  static fromEncodingData(data: unknown): CreatedApplicationVersion {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded CreatedApplicationVersion: ${data}`);
    }
    return new CreatedApplicationVersion({
      appId: data.get('app-id'),
      deleted: data.get('deleted'),
      changedRound: data.get('changed-round'),
      application:
        typeof data.get('application') !== 'undefined'
          ? Application.fromEncodingData(data.get('application'))
          : undefined,
      changedKeys: data.get('changed-keys'),
    });
  }
}

/**
 * Versions of an account's objects.
 */
export class AccountVersionsResponse implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'versions',
          valueSchema: new ArraySchema(AccountVersion.encodingSchema),
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
   * descending page resumed from `next`, the round in the token. With
   * `rounds`, the largest requested round not listed by an earlier page.
   */
  public round: bigint;

  public versions: AccountVersion[];

  /**
   * Present if and only if more versions remain: provide it as the `next`
   * parameter to get them.
   */
  public nextToken?: string;

  /**
   * Creates a new `AccountVersionsResponse` object.
   * @param round - The last round of the range: `max-round`, or the latest round. On a
   * @param versions -
   * @param nextToken - Present if and only if more versions remain: provide it as the `next`
   */
  constructor({
    round,
    versions,
    nextToken,
  }: {
    round: number | bigint;
    versions: AccountVersion[];
    nextToken?: string;
  }) {
    this.round = ensureBigInt(round);
    this.versions = versions;
    this.nextToken = nextToken;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AccountVersionsResponse.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['versions', this.versions.map((v) => v.toEncodingData())],
      ['next-token', this.nextToken],
    ]);
  }

  static fromEncodingData(data: unknown): AccountVersionsResponse {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AccountVersionsResponse: ${data}`);
    }
    return new AccountVersionsResponse({
      round: data.get('round'),
      versions: (data.get('versions') ?? []).map((v: unknown) =>
        AccountVersion.fromEncodingData(v)
      ),
      nextToken: data.get('next-token'),
    });
  }
}

/**
 * A call or inner transaction that read data a {@link QueryProtocolNote} is
 * about.
 */
export class QueryProtocolNoteHit implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'group', valueSchema: new Uint64Schema(), omitEmpty: false },
        {
          key: 'path',
          valueSchema: new ArraySchema(new Uint64Schema()),
          omitEmpty: false,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** The 0-based index of the call in the request. */
  public group: number;

  /**
   * The path of the transaction in the call's group, as in simulate's
   * `failedAt`: `[0]` for the call, `[0, i]` for its inner transaction `i`,
   * and so on.
   */
  public path: number[];

  /**
   * Creates a new `QueryProtocolNoteHit` object.
   * @param group - The 0-based index of the call in the request.
   * @param path - The path of the transaction in the call's group.
   */
  constructor({
    group,
    path,
  }: {
    group: number | bigint;
    path: (number | bigint)[];
  }) {
    this.group = ensureSafeInteger(group);
    this.path = path.map(ensureSafeInteger);
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return QueryProtocolNoteHit.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['group', this.group],
      ['path', this.path],
    ]);
  }

  static fromEncodingData(data: unknown): QueryProtocolNoteHit {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded QueryProtocolNoteHit: ${data}`);
    }
    return new QueryProtocolNoteHit({
      group: data.get('group') ?? 0,
      path: data.get('path') ?? [],
    });
  }
}

/**
 * The codes of {@link QueryProtocolNote}, as of this client. A newer node
 * may send others.
 * - `semantics-changed`: consensus parameters that affect transactions differ;
 *   the message lists each, old → new.
 * - `no-heartbeat-challenges`: no heartbeat challenge applies, since earlier
 *   challenge rounds ran other rules.
 * - `no-load-history`: a congestion tax computed from a load of 0.
 * - `block-incentive-fields`: `block` read an incentive field of a round
 *   without incentives, which reads as zero.
 * - `block-hash-fields`: `block` read a SHA-512 or SHA-256 header field of a
 *   round that did not compute it, which reads as zero bytes.
 * - `online-stake-includes-expired`: `online_stake` included keys that expire
 *   before the simulated round.
 * - `account-incentive-fields`: an account incentive field read before
 *   incentives, which reads as false or 0.
 * - `app-version-starts-at-upgrade`: `AppVersion` counts from the upgrade on.
 */
export type QueryProtocolNoteCode =
  | 'semantics-changed'
  | 'no-heartbeat-challenges'
  | 'no-load-history'
  | 'block-incentive-fields'
  | 'block-hash-fields'
  | 'online-stake-includes-expired'
  | 'account-incentive-fields'
  | 'app-version-starts-at-upgrade';

/**
 * A note about querying a round under a later protocol: where the run differs
 * from what the chain recorded, or read data the chain never produced.
 */
export class QueryProtocolNote implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'code', valueSchema: new StringSchema(), omitEmpty: false },
        { key: 'message', valueSchema: new StringSchema(), omitEmpty: false },
        {
          key: 'hits',
          valueSchema: new OptionalSchema(
            new ArraySchema(QueryProtocolNoteHit.encodingSchema)
          ),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** What the note is about: a {@link QueryProtocolNoteCode}. */
  public code: QueryProtocolNoteCode | (string & {});

  /** The note, for people. */
  public message: string;

  /**
   * The calls and inner transactions that read the data the note is about,
   * at most 16.
   * Undefined for notes about the protocol change as a whole.
   */
  public hits?: QueryProtocolNoteHit[];

  /**
   * Creates a new `QueryProtocolNote` object.
   * @param code - What the note is about.
   * @param message - The note, for people.
   * @param hits - The transactions that read the data the note is about.
   */
  constructor({
    code,
    message,
    hits,
  }: {
    code: string;
    message: string;
    hits?: QueryProtocolNoteHit[];
  }) {
    this.code = code;
    this.message = message;
    this.hits = hits;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return QueryProtocolNote.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['code', this.code],
      ['message', this.message],
      [
        'hits',
        typeof this.hits !== 'undefined'
          ? this.hits.map((v) => v.toEncodingData())
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): QueryProtocolNote {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded QueryProtocolNote: ${data}`);
    }
    return new QueryProtocolNote({
      code: data.get('code') ?? '',
      message: data.get('message') ?? '',
      hits:
        typeof data.get('hits') !== 'undefined'
          ? data
              .get('hits')
              .map((v: unknown) => QueryProtocolNoteHit.fromEncodingData(v))
          : undefined,
    });
  }
}

/**
 * How a query request's `protocol` applied to a queried round
 * ({@link QueryRoundResult.protocolOverride}).
 */
export class QueryProtocolOverride implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'from', valueSchema: new StringSchema(), omitEmpty: false },
        { key: 'to', valueSchema: new StringSchema(), omitEmpty: false },
        { key: 'applied', valueSchema: new BooleanSchema(), omitEmpty: false },
        {
          key: 'notes',
          valueSchema: new OptionalSchema(
            new ArraySchema(QueryProtocolNote.encodingSchema)
          ),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** The protocol the round after the queried one really ran. */
  public from: string;

  /** The requested protocol, with aliases (`v42`, `latest`) resolved. */
  public to: string;

  /** False when `from` is already `to`: the round was queried as it is. */
  public applied: boolean;

  /**
   * Where running under `to` differs from what the chain recorded, or read
   * data the chain never produced. Only set when `applied`.
   */
  public notes?: QueryProtocolNote[];

  /**
   * Creates a new `QueryProtocolOverride` object.
   * @param from - The protocol the round after the queried one really ran.
   * @param to - The requested protocol, with aliases resolved.
   * @param applied - False when `from` is already `to`.
   * @param notes - Where the run differs from the chain.
   */
  constructor({
    from,
    to,
    applied,
    notes,
  }: {
    from: string;
    to: string;
    applied: boolean;
    notes?: QueryProtocolNote[];
  }) {
    this.from = from;
    this.to = to;
    this.applied = applied;
    this.notes = notes;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return QueryProtocolOverride.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['from', this.from],
      ['to', this.to],
      ['applied', this.applied],
      [
        'notes',
        typeof this.notes !== 'undefined'
          ? this.notes.map((v) => v.toEncodingData())
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): QueryProtocolOverride {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded QueryProtocolOverride: ${data}`);
    }
    return new QueryProtocolOverride({
      from: data.get('from') ?? '',
      to: data.get('to') ?? '',
      applied: data.get('applied') ?? false,
      notes:
        typeof data.get('notes') !== 'undefined'
          ? data
              .get('notes')
              .map((v: unknown) => QueryProtocolNote.fromEncodingData(v))
          : undefined,
    });
  }
}

/**
 * A {@link SimulateRequest} that may hold several transaction groups, with
 * {@link DTSimulateRequest.fromTransactions} to build one from unsigned
 * transactions.
 *
 * `txnGroups` may hold several groups, up to the node's `MaxAPISimulateGroups`
 * (default 16). They run in order as consecutive groups of one simulated
 * block: each group sees the effects of the groups before it, a transaction or
 * lease used by an earlier group is a duplicate, and the groups share the
 * block's byte limit. A group that fails is rolled back and the later groups
 * still run, except after a failed post-evaluation check (placeholder PQ
 * signatures with `fixSigners`) or a corrupted evaluator: every later group is
 * then reported as not simulated.
 *
 * For read-only calls at several rounds, each alone or under another
 * protocol, use {@link DTAlgodClient.query}.
 */
export class DTSimulateRequest extends SimulateRequest {
  /** A copy of a {@link SimulateRequest}, with its own list of groups. */
  static from(request: SimulateRequest): DTSimulateRequest {
    return new DTSimulateRequest({
      txnGroups: [...request.txnGroups],
      allowEmptySignatures: request.allowEmptySignatures,
      allowMoreLogging: request.allowMoreLogging,
      allowUnnamedResources: request.allowUnnamedResources,
      execTraceConfig: request.execTraceConfig,
      extraOpcodeBudget: request.extraOpcodeBudget,
      fixSigners: request.fixSigners,
      round: request.round,
    });
  }

  /**
   * A request simulating unsigned transactions, one inner array per group,
   * such as the transactions of `TransactionComposer.buildTransactions()`.
   * Each transaction is sent with an empty signature, and
   * `allowEmptySignatures` defaults to true.
   *
   * A group of several transactions that has no group ID yet gets one: this
   * sets `group` on those transactions. A group where any transaction already
   * has one is left as it is, and IDs are never recomputed, so build new
   * transactions for each request rather than changing and reusing them.
   *
   * #### Example
   * ```typescript
   * const request = DTSimulateRequest.fromTransactions(
   *   [group1Txns, group2Txns],
   *   { allowUnnamedResources: true }
   * );
   * const res = await algodClient.simulateTransactions(request).do();
   * ```
   *
   * @param groups - The transactions, one array per group.
   * @param fields - The other request fields.
   */
  static fromTransactions(
    groups: Transaction[][],
    fields: Omit<
      ConstructorParameters<typeof DTSimulateRequest>[0],
      'txnGroups'
    > = {}
  ): DTSimulateRequest {
    const txnGroups = groups.map((txns, i) => {
      if (txns.length === 0) {
        throw new Error(`Transaction group ${i} is empty`);
      }
      if (txns.length > 1 && txns.every((txn) => txn.group === undefined)) {
        assignGroupID(txns);
      }
      return new SimulateRequestTransactionGroup({
        txns: txns.map((txn) => new SignedTransaction({ txn })),
      });
    });
    return new DTSimulateRequest({
      allowEmptySignatures: true,
      ...fields,
      txnGroups,
    });
  }

  static fromEncodingData(data: unknown): DTSimulateRequest {
    return DTSimulateRequest.from(SimulateRequest.fromEncodingData(data));
  }
}

/** How the node prefixes the failure message of a group it skipped. */
const NOT_SIMULATED_PREFIX = 'not simulated: ';

/**
 * The outcome of one transaction group of a simulate response, from
 * {@link DTSimulateResponse.groupResult}.
 */
export type SimulateGroupOutcome = {
  /** The index of the group in the request. */
  groupIndex: number;
  /** The round the simulation ran after (the response's `lastRound`). */
  round: bigint;
} & (
  | { ok: true; result: SimulateTransactionGroupResult }
  | { ok: false; error: SimulateGroupError }
);

/**
 * A {@link SimulateResponse} with helpers for a request of several groups.
 *
 * `txnGroups` has one result per requested group, in request order. Each
 * group's failure is in its own `failureMessage` / `failedAt` (0-based).
 * `initialStates` holds the state before the first group, recorded the first
 * time any group accessed it, and leaves out apps created during the
 * simulation.
 */
export class DTSimulateResponse extends SimulateResponse {
  /**
   * How many transaction groups the request had, set when the response comes
   * from `simulateTransactions().do()`. Not part of the encoding.
   */
  public requestGroupCount?: number;

  /**
   * The outcome of one transaction group: its result, or a
   * {@link SimulateGroupError} saying why there is none (the group failed,
   * it was not simulated, or it is missing).
   *
   * #### Example
   * ```typescript
   * const res = await algodClient.simulateTransactions(request).do();
   * const outcome = res.groupResult(1);
   * if (outcome.ok) {
   *   console.log(outcome.result.txnResults[0].txnResult.logs);
   * } else {
   *   console.log(outcome.error.kind, outcome.error.message);
   * }
   * ```
   *
   * @param groupIndex - The index of the group in the request.
   * @throws RangeError if `groupIndex` is not a non-negative integer.
   */
  groupResult(groupIndex: number): SimulateGroupOutcome {
    if (!Number.isInteger(groupIndex) || groupIndex < 0) {
      throw new RangeError(`Invalid group index ${groupIndex}`);
    }
    const at = { groupIndex, round: this.lastRound };
    const fail = (
      fields: Omit<
        ConstructorParameters<typeof SimulateGroupError>[0],
        keyof typeof at
      >
    ): SimulateGroupOutcome => ({
      ok: false,
      ...at,
      error: new SimulateGroupError({ ...at, ...fields }),
    });

    const result = this.txnGroups[groupIndex];
    if (result === undefined) return fail({ kind: 'missing' });
    const message = result.failureMessage;
    if (message === undefined || message === '') {
      return { ok: true, ...at, result };
    }
    if (message.startsWith(NOT_SIMULATED_PREFIX)) {
      return fail({
        kind: 'not-simulated',
        failureMessage: message.slice(NOT_SIMULATED_PREFIX.length),
        result,
      });
    }
    return fail({
      kind: 'group',
      failureMessage: message,
      failedAt: result.failedAt,
      result,
    });
  }

  /**
   * The outcome of every transaction group, by index in the request. See
   * {@link DTSimulateResponse.groupResult}.
   *
   * @param groupCount - How many groups the request had. Defaults to
   * `requestGroupCount`, which `simulateTransactions().do()` sets, and
   * otherwise to the number of group results.
   */
  groupResults(groupCount?: number): SimulateGroupOutcome[] {
    const width = groupCount ?? this.requestGroupCount ?? this.txnGroups.length;
    return Array.from({ length: width }, (_, groupIndex) =>
      this.groupResult(groupIndex)
    );
  }

  static fromEncodingData(data: unknown): DTSimulateResponse {
    const base = SimulateResponse.fromEncodingData(data);
    return new DTSimulateResponse({
      lastRound: base.lastRound,
      txnGroups: base.txnGroups,
      version: base.version,
      evalOverrides: base.evalOverrides,
      execTraceConfig: base.execTraceConfig,
      initialStates: base.initialStates,
    });
  }
}

/**
 * A {@link NamedMapSchema} that decodes a map with keys missing instead of
 * throwing: they are left out of the decoded map, and the model gives them a
 * default. Encoding is unchanged, every key written as its entry says. Used
 * for the node's capabilities, so that a node that drops a key, or does not
 * have it yet, can still be read.
 */
class LenientNamedMapSchema extends NamedMapSchema {
  public fromPreparedMsgpack(
    encoded: MsgpackEncodingData,
    rawStringProvider: MsgpackRawStringProvider
  ): Map<string, unknown> {
    if (!(encoded instanceof Map)) {
      throw new Error('NamedMapSchema data must be a Map');
    }
    const map = new Map<string, unknown>();
    for (const entry of this.getEntries()) {
      if (encoded.has(entry.key)) {
        map.set(
          entry.key,
          entry.valueSchema.fromPreparedMsgpack(
            encoded.get(entry.key),
            rawStringProvider.withMapValue(entry.key)
          )
        );
      }
    }
    return map;
  }

  public fromPreparedJSON(encoded: JSONEncodingData): Map<string, unknown> {
    if (
      encoded == null ||
      typeof encoded !== 'object' ||
      Array.isArray(encoded)
    ) {
      throw new Error('NamedMapSchema data must be an object');
    }
    const map = new Map<string, unknown>();
    for (const entry of this.getEntries()) {
      if (Object.prototype.hasOwnProperty.call(encoded, entry.key)) {
        map.set(
          entry.key,
          entry.valueSchema.fromPreparedJSON(
            (encoded as Record<string, JSONEncodingData>)[entry.key]
          )
        );
      }
    }
    return map;
  }
}

/**
 * An {@link OptionalSchema} whose value is left out only when undefined, not
 * when it is the inner schema's default: for an object whose presence says
 * something, such as {@link CapabilitiesResponse.stateChanges}, which a node
 * with no size limit (`maxResponseBytes` 0) still sends.
 */
class PresentOptionalSchema extends OptionalSchema {
  // eslint-disable-next-line class-methods-use-this
  public isDefaultValue(data: unknown): boolean {
    return data === undefined;
  }
}

/**
 * The limits a node places on `POST /v2/query` requests
 * ({@link CapabilitiesResponse.query}). The values are the ones the node
 * applies, after it clamps its configuration.
 */
export class QueryLimits implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new LenientNamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'max-calls', valueSchema: new Uint64Schema(), omitEmpty: false },
        {
          key: 'max-call-budget',
          valueSchema: new Uint64Schema(),
          omitEmpty: false,
        },
        {
          key: 'max-call-log-bytes',
          valueSchema: new Uint64Schema(),
          omitEmpty: false,
        },
        {
          key: 'max-call-state-bytes',
          valueSchema: new Uint64Schema(),
          omitEmpty: false,
        },
        {
          key: 'max-response-bytes',
          valueSchema: new Uint64Schema(),
          omitEmpty: false,
        },
        {
          key: 'max-rounds',
          valueSchema: new Uint64Schema(),
          omitEmpty: false,
        },
        {
          key: 'max-total-calls',
          valueSchema: new Uint64Schema(),
          omitEmpty: false,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** The most calls a request may hold (node config `MaxAPIQueryCalls`). */
  public maxCalls: number;

  /**
   * The most opcode budget a call may ask for, and the budget of a call when
   * the request sets none (node config `MaxAPIQueryCallBudget`).
   */
  public maxCallBudget: number;

  /**
   * The most bytes each program of a call may log, in up to 2048 logs. 0 means
   * the protocol's limits: 1024 bytes in 32 logs (node config
   * `MaxAPIQueryCallLogBytes`).
   */
  public maxCallLogBytes: number;

  /**
   * The most bytes of ledger state one call may read (accounts, holdings and
   * local states, asset and app params, boxes, each counted once). A call that
   * reads more fails with its own error, and the other calls run on. 0 means
   * no limit (node config `MaxAPIQueryCallStateBytes`).
   */
  public maxCallStateBytes: number;

  /**
   * The most bytes of logs and errors a request may return, across its calls
   * and rounds: a round listed twice counts twice, and each log counts
   * `QUERY_LOG_OVERHEAD_BYTES` (48) more than its length. A request that goes
   * over fails with a 400 (`isQueryResponseTooLarge`). 0 means no limit (node
   * config `MaxAPIQueryResponseBytes`).
   */
  public maxResponseBytes: number;

  /**
   * The most entries a request may list in `rounds`, duplicates included
   * (node config `MaxAPIQueryRounds`).
   */
  public maxRounds: number;

  /**
   * The most call runs a request may ask for: its calls times the entries it
   * lists in `rounds` (1 when it lists none), duplicates included. Split a
   * request by this as well as by `maxCalls` and `maxRounds` (node config
   * `MaxAPIQueryTotalCalls`). Nodes from before this limit don't report it;
   * it is `maxCalls * maxRounds` for them.
   */
  public maxTotalCalls: number;

  /**
   * Creates a new `QueryLimits` object.
   * @param maxCalls - The most calls a request may hold.
   * @param maxCallBudget - The most opcode budget of a call, and its default.
   * @param maxCallLogBytes - The most bytes each program of a call may log; 0
   * means the protocol's limits.
   * @param maxCallStateBytes - The most bytes of ledger state a call may read;
   * 0 means no limit.
   * @param maxResponseBytes - The most bytes of logs and errors a request may
   * return; 0 means no limit.
   * @param maxRounds - The most entries a request may list in `rounds`.
   * @param maxTotalCalls - The most calls times listed rounds a request may
   * ask for; `maxCalls * maxRounds` when absent or 0, as on older nodes.
   */
  constructor({
    maxCalls,
    maxCallBudget,
    maxCallLogBytes,
    maxCallStateBytes,
    maxResponseBytes,
    maxRounds,
    maxTotalCalls,
  }: {
    maxCalls: number | bigint;
    maxCallBudget: number | bigint;
    maxCallLogBytes: number | bigint;
    maxCallStateBytes: number | bigint;
    maxResponseBytes: number | bigint;
    maxRounds: number | bigint;
    maxTotalCalls?: number | bigint;
  }) {
    this.maxCalls = ensureSafeInteger(maxCalls);
    this.maxCallBudget = ensureSafeInteger(maxCallBudget);
    this.maxCallLogBytes = ensureSafeInteger(maxCallLogBytes);
    this.maxCallStateBytes = ensureSafeInteger(maxCallStateBytes);
    this.maxResponseBytes = ensureSafeInteger(maxResponseBytes);
    this.maxRounds = ensureSafeInteger(maxRounds);
    // Absent (or 0, which a node never reports): calls and rounds are the
    // only limits, as on nodes from before this one. Saturates rather than
    // throwing on a nonsense answer.
    this.maxTotalCalls = maxTotalCalls
      ? ensureSafeInteger(maxTotalCalls)
      : Math.min(this.maxCalls * this.maxRounds, Number.MAX_SAFE_INTEGER);
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return QueryLimits.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['max-calls', this.maxCalls],
      ['max-call-budget', this.maxCallBudget],
      ['max-call-log-bytes', this.maxCallLogBytes],
      ['max-call-state-bytes', this.maxCallStateBytes],
      ['max-response-bytes', this.maxResponseBytes],
      ['max-rounds', this.maxRounds],
      ['max-total-calls', this.maxTotalCalls],
    ]);
  }

  static fromEncodingData(data: unknown): QueryLimits {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded QueryLimits: ${data}`);
    }
    // A key the node left out takes the most restrictive value that still
    // lets a request through, or 0 where 0 is the node's own "no limit".
    return new QueryLimits({
      maxCalls: data.get('max-calls') ?? 1,
      maxCallBudget: data.get('max-call-budget') ?? 700,
      maxCallLogBytes: data.get('max-call-log-bytes') ?? 0,
      maxCallStateBytes: data.get('max-call-state-bytes') ?? 0,
      maxResponseBytes: data.get('max-response-bytes') ?? 0,
      maxRounds: data.get('max-rounds') ?? 1,
      maxTotalCalls: data.get('max-total-calls'),
    });
  }
}

/**
 * The limits a node places on `POST /v2/transactions/simulate` requests
 * ({@link CapabilitiesResponse.simulate}). The values are the ones the node
 * applies, after it clamps its configuration.
 */
export class SimulateLimits implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new LenientNamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        {
          key: 'max-txn-groups',
          valueSchema: new Uint64Schema(),
          omitEmpty: false,
        },
        {
          key: 'max-extra-opcode-budget',
          valueSchema: new Uint64Schema(),
          omitEmpty: false,
        },
        {
          key: 'exec-trace-config',
          valueSchema: new ArraySchema(new StringSchema()),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The most transaction groups a request may hold (node config
   * `MaxAPISimulateGroups`).
   */
  public maxTxnGroups: number;

  /**
   * The most `extraOpcodeBudget` a request may ask for. Each top-level
   * transaction group of the request gets it (node config
   * `MaxAPISimulateExtraOpcodeBudget`).
   */
  public maxExtraOpcodeBudget: number;

  /**
   * The fork's `execTraceConfig` options the node takes, beyond upstream's:
   * `state-change-app-id` (`SimulateTraceConfig.stateChangeAppId`). Listed
   * only with `developerApi`, as every trace needs it. Empty on stock algod
   * and on dtalgod nodes from before them, which answer 400 to them. `DTAlgodClient.supportsStateChangeAppId` reads it. A value this
   * client does not know is kept.
   */
  public execTraceConfig: string[];

  /**
   * Creates a new `SimulateLimits` object.
   * @param maxTxnGroups - The most transaction groups a request may hold.
   * @param maxExtraOpcodeBudget - The most `extraOpcodeBudget`, per group.
   * @param execTraceConfig - The fork's `execTraceConfig` options the node
   * takes.
   */
  constructor({
    maxTxnGroups,
    maxExtraOpcodeBudget,
    execTraceConfig = [],
  }: {
    maxTxnGroups: number | bigint;
    maxExtraOpcodeBudget: number | bigint;
    execTraceConfig?: string[];
  }) {
    this.maxTxnGroups = ensureSafeInteger(maxTxnGroups);
    this.maxExtraOpcodeBudget = ensureSafeInteger(maxExtraOpcodeBudget);
    this.execTraceConfig = execTraceConfig;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return SimulateLimits.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['max-txn-groups', this.maxTxnGroups],
      ['max-extra-opcode-budget', this.maxExtraOpcodeBudget],
      ['exec-trace-config', this.execTraceConfig],
    ]);
  }

  static fromEncodingData(data: unknown): SimulateLimits {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded SimulateLimits: ${data}`);
    }
    return new SimulateLimits({
      // A key the node left out takes stock algod's value.
      maxTxnGroups: data.get('max-txn-groups') ?? 1,
      maxExtraOpcodeBudget: data.get('max-extra-opcode-budget') ?? 320000,
      execTraceConfig: data.get('exec-trace-config') ?? [],
    });
  }
}

/**
 * The limit a node places on `GET /v2/deltas/{round}/txn/state-changes`, and
 * what it can add to the answer ({@link CapabilitiesResponse.stateChanges}),
 * present when the node serves it (node config `EnableTimeTravel`).
 */
export class StateChangesLimits implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new LenientNamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        {
          key: 'max-response-bytes',
          valueSchema: new Uint64Schema(),
          omitEmpty: false,
        },
        {
          key: 'include',
          valueSchema: new ArraySchema(new StringSchema()),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The most bytes an answer may take, encoded (msgpack, as the client asks
   * for it); a larger one fails with a 400 (`isStateChangesTooLarge`): narrow
   * the request with `app()` or `txids()`. 0 means no limit (node config
   * `MaxAPIStateChangesResponseBytes`).
   */
  public maxResponseBytes: number;

  /**
   * What the node can add to the answer with `include()`: of `accounts`,
   * `assets` and `apps` (`groups`), `budget`, `reads` and `trace`, the ones
   * it serves; `trace` only with `EnableDeveloperAPI`. Empty on a node from
   * before full deltas, which would ignore `include`; a node with only the
   * group values answers 400 for the others. `getTxnStateChangesForRound`
   * checks each value before sending `include`, and
   * `DTAlgodClient.supportsStateChangesInclude` reads it. A value this client
   * does not know is kept.
   */
  public include: string[];

  /**
   * Creates a new `StateChangesLimits` object.
   * @param maxResponseBytes - The most bytes an answer may take; 0 means no
   * limit.
   * @param include - What the node can add to the answer with `include()`.
   */
  constructor({
    maxResponseBytes,
    include = [],
  }: {
    maxResponseBytes: number | bigint;
    include?: string[];
  }) {
    this.maxResponseBytes = ensureSafeInteger(maxResponseBytes);
    this.include = include;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return StateChangesLimits.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['max-response-bytes', this.maxResponseBytes],
      ['include', this.include],
    ]);
  }

  static fromEncodingData(data: unknown): StateChangesLimits {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded StateChangesLimits: ${data}`);
    }
    // A key the node left out is 0, the node's own "no limit", and an
    // include left out is none.
    return new StateChangesLimits({
      maxResponseBytes: data.get('max-response-bytes') ?? 0,
      include: data.get('include') ?? [],
    });
  }
}

/**
 * The fork features a node has on, and the limits it places on simulate and
 * query requests (`GET /v2/capabilities`, tag `dtalgorand`). Every dtalgod
 * node serves it; stock algod answers 404. The values are the ones the node
 * applies, after it clamps its configuration.
 *
 * `query` is undefined when the node has queries disabled
 * (`MaxAPIQueryCalls` 0): fall back to simulate then, one round per request.
 * `stateChanges` is undefined when the node does not serve
 * `getTxnStateChangesForRound`.
 *
 * Decoding tolerates keys the node leaves out, as an older or newer node may,
 * and ignores keys this client does not know. A missing key takes a safe
 * default: false for the flags, 0 for `timeLimitSeconds`, stock algod's
 * simulate limits (1 group, 320,000 extra budget), and for the query limits
 * 1 call, 1 round, a budget of 700, 0 (none or the protocol's) for the byte
 * limits, and `maxCalls * maxRounds` for `maxTotalCalls`. A value of the
 * wrong type still fails.
 */
export class CapabilitiesResponse implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new LenientNamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        {
          key: 'time-travel',
          valueSchema: new BooleanSchema(),
          omitEmpty: false,
        },
        {
          key: 'developer-api',
          valueSchema: new BooleanSchema(),
          omitEmpty: false,
        },
        {
          key: 'time-limit-seconds',
          valueSchema: new Uint64Schema(),
          omitEmpty: false,
        },
        {
          key: 'simulate',
          valueSchema: SimulateLimits.encodingSchema,
          omitEmpty: false,
        },
        {
          key: 'query',
          valueSchema: new OptionalSchema(QueryLimits.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'state-changes',
          valueSchema: new PresentOptionalSchema(
            StateChangesLimits.encodingSchema
          ),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The capabilities of stock algod, which has no capabilities endpoint: no
   * time travel, no queries, and simulate with one transaction group per
   * request and 320,000 extra opcode budget. `reported` is false. `developerApi` and
   * `timeLimitSeconds` are unknown and set to false and 0: a stock algod with
   * its own `EnableDeveloperAPI` (LocalNet has it) does allow
   * `execTraceConfig`.
   */
  static stock(): CapabilitiesResponse {
    return new CapabilitiesResponse({
      timeTravel: false,
      developerApi: false,
      timeLimitSeconds: 0,
      simulate: new SimulateLimits({
        maxTxnGroups: 1,
        maxExtraOpcodeBudget: 320000,
      }),
      reported: false,
    });
  }

  /**
   * Whether the node has time travel (node config `EnableTimeTravel`): reads
   * at past rounds, the `...Versions` methods, `getAssetHolders` (which also
   * needs the holders index), simulate `round` and query `rounds` at any
   * round since genesis, not only the node's last few rounds.
   * {@link DTAlgodClient.supportsDT} reads it.
   */
  public timeTravel: boolean;

  /**
   * Whether requests may set simulate's `execTraceConfig` and query's
   * protocol `future` (node config `EnableDeveloperAPI`).
   */
  public developerApi: boolean;

  /**
   * How long, in seconds, the node works on a simulate, query, versions or
   * delta request before giving up with a 504 (`isTimeLimitExceeded`); 0
   * means no limit. The node derives it from its `RestWriteTimeoutSeconds`,
   * leaving time to write the answer.
   */
  public timeLimitSeconds: number;

  /** The limits of `POST /v2/transactions/simulate`. */
  public simulate: SimulateLimits;

  /**
   * The limits of `POST /v2/query` (`DTAlgodClient.query`). Undefined
   * when the node has queries disabled: use simulate then.
   */
  public query?: QueryLimits;

  /**
   * The limit of `GET /v2/deltas/{round}/txn/state-changes`
   * (`DTAlgodClient.getTxnStateChangesForRound`). Undefined when the node does
   * not serve it: it has time travel off, or it predates the endpoint.
   * {@link DTAlgodClient.supportsStateChanges} reads it.
   */
  public stateChanges?: StateChangesLimits;

  /**
   * Whether the node reported these capabilities: true when decoded from its
   * response, false for {@link CapabilitiesResponse.stock}, the fallback for
   * stock algod. Not part of the response's encoding.
   */
  public reported: boolean;

  /**
   * Creates a new `CapabilitiesResponse` object.
   * @param timeTravel - Whether the node has time travel.
   * @param developerApi - Whether `execTraceConfig` and the protocol `future`
   * are allowed.
   * @param timeLimitSeconds - The time limit of a request; 0 means no limit.
   * @param simulate - The limits of simulate requests.
   * @param query - The limits of `POST /v2/query`; undefined when the node has
   * queries disabled.
   * @param stateChanges - The limit of the state changes endpoint; undefined
   * when the node does not serve it.
   * @param reported - Whether the node reported these capabilities. Not
   * encoded; defaults to false, and decoding sets it to true.
   */
  constructor({
    timeTravel,
    developerApi,
    timeLimitSeconds,
    simulate,
    query,
    stateChanges,
    reported = false,
  }: {
    timeTravel: boolean;
    developerApi: boolean;
    timeLimitSeconds: number | bigint;
    simulate: SimulateLimits;
    query?: QueryLimits;
    stateChanges?: StateChangesLimits;
    reported?: boolean;
  }) {
    this.timeTravel = timeTravel;
    this.developerApi = developerApi;
    this.timeLimitSeconds = ensureSafeInteger(timeLimitSeconds);
    this.simulate = simulate;
    this.query = query;
    this.stateChanges = stateChanges;
    this.reported = reported;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return CapabilitiesResponse.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['time-travel', this.timeTravel],
      ['developer-api', this.developerApi],
      ['time-limit-seconds', this.timeLimitSeconds],
      ['simulate', this.simulate.toEncodingData()],
      [
        'query',
        typeof this.query !== 'undefined'
          ? this.query.toEncodingData()
          : undefined,
      ],
      [
        'state-changes',
        typeof this.stateChanges !== 'undefined'
          ? this.stateChanges.toEncodingData()
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): CapabilitiesResponse {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded CapabilitiesResponse: ${data}`);
    }
    return new CapabilitiesResponse({
      timeTravel: data.get('time-travel') ?? false,
      developerApi: data.get('developer-api') ?? false,
      timeLimitSeconds: data.get('time-limit-seconds') ?? 0,
      simulate: SimulateLimits.fromEncodingData(
        data.get('simulate') ?? new Map()
      ),
      query:
        typeof data.get('query') !== 'undefined'
          ? QueryLimits.fromEncodingData(data.get('query'))
          : undefined,
      stateChanges:
        typeof data.get('state-changes') !== 'undefined'
          ? StateChangesLimits.fromEncodingData(data.get('state-changes'))
          : undefined,
      reported: true,
    });
  }
}

/**
 * One call of a query ({@link QueryRequest.calls}): the args and references of
 * its app call. Every resource is available to the call unnamed, so the
 * references are only needed by programs before v9, which address accounts,
 * apps and assets by index.
 */
export class QueryCall implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        {
          key: 'args',
          valueSchema: new OptionalSchema(
            new ArraySchema(new ByteArraySchema())
          ),
          omitEmpty: true,
        },
        {
          key: 'accounts',
          valueSchema: new OptionalSchema(new ArraySchema(new StringSchema())),
          omitEmpty: true,
        },
        {
          key: 'foreign-apps',
          valueSchema: new OptionalSchema(new ArraySchema(new Uint64Schema())),
          omitEmpty: true,
        },
        {
          key: 'foreign-assets',
          valueSchema: new OptionalSchema(new ArraySchema(new Uint64Schema())),
          omitEmpty: true,
        },
        {
          key: 'boxes',
          valueSchema: new OptionalSchema(
            new ArraySchema(BoxReference.encodingSchema)
          ),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** The application args. */
  public args?: Uint8Array[];

  /** The accounts the call references (`Txn.Accounts`). */
  public accounts?: Address[];

  /** The apps the call references (`Txn.Applications`). */
  public foreignApps?: bigint[];

  /** The assets the call references (`Txn.Assets`). */
  public foreignAssets?: bigint[];

  /**
   * The boxes the call references. App 0, or the called app's ID, is the
   * called app; the node adds any other app to `foreignApps`. The constructor
   * takes names as bytes or base64 strings, as {@link BoxReference} does.
   */
  public boxes?: BoxReference[];

  /**
   * Creates a new `QueryCall` object.
   * @param args - The application args, as bytes.
   * @param accounts - The accounts the call references.
   * @param foreignApps - The apps the call references.
   * @param foreignAssets - The assets the call references.
   * @param boxes - The boxes the call references; app 0 is the called app.
   * Names are bytes or base64 strings, as for {@link BoxReference}.
   */
  constructor({
    args,
    accounts,
    foreignApps,
    foreignAssets,
    boxes,
  }: {
    args?: Uint8Array[];
    accounts?: (string | Address)[];
    foreignApps?: (number | bigint)[];
    foreignAssets?: (number | bigint)[];
    boxes?: (
      | BoxReference
      | { app: number | bigint; name: string | Uint8Array }
    )[];
  } = {}) {
    this.args = args;
    this.accounts =
      typeof accounts === 'undefined'
        ? undefined
        : accounts.map((a) =>
            typeof a === 'string' ? Address.fromString(a) : a
          );
    this.foreignApps =
      typeof foreignApps === 'undefined'
        ? undefined
        : foreignApps.map(ensureUint64);
    this.foreignAssets =
      typeof foreignAssets === 'undefined'
        ? undefined
        : foreignAssets.map(ensureUint64);
    this.boxes =
      typeof boxes === 'undefined'
        ? undefined
        : boxes.map((b) =>
            b instanceof BoxReference ? b : new BoxReference(b)
          );
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return QueryCall.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['args', this.args],
      [
        'accounts',
        typeof this.accounts !== 'undefined'
          ? this.accounts.map((v) => v.toString())
          : undefined,
      ],
      ['foreign-apps', this.foreignApps],
      ['foreign-assets', this.foreignAssets],
      [
        'boxes',
        typeof this.boxes !== 'undefined'
          ? this.boxes.map((v) => v.toEncodingData())
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): QueryCall {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded QueryCall: ${data}`);
    }
    return new QueryCall({
      args: data.get('args'),
      accounts: data.get('accounts'),
      foreignApps: data.get('foreign-apps'),
      foreignAssets: data.get('foreign-assets'),
      boxes:
        typeof data.get('boxes') !== 'undefined'
          ? data
              .get('boxes')
              .map((v: unknown) => BoxReference.fromEncodingData(v))
          : undefined,
    });
  }
}

/** What {@link QueryCall}'s constructor takes. */
export type QueryCallParams = ConstructorParameters<typeof QueryCall>[0];

/** A state schema, as a model or a plain object. */
type StateSchemaParams =
  | ApplicationStateSchema
  | ConstructorParameters<typeof ApplicationStateSchema>[0];

function toStateSchema(
  schema: StateSchemaParams | undefined
): ApplicationStateSchema | undefined {
  if (typeof schema === 'undefined' || schema instanceof ApplicationStateSchema)
    return schema;
  return new ApplicationStateSchema(schema);
}

/**
 * A request of `POST /v2/query` (`DTAlgodClient.query`): read-only TEAL
 * calls at one or more rounds. Exactly one of `program` and `appId` is
 * required.
 *
 * Each call is an app call alone in its group, in the block after each queried
 * round, on the state that round left: an app create running `program` (at
 * the app ID the next block would give it), or a NoOp call of `appId`. There
 * are no signatures, fees, minimum balances or leases, and every resource is
 * available unnamed. Writes are dropped after each call, so calls do not see
 * each other's effects; inner transactions run but are not echoed. A failed
 * call does not affect the others.
 *
 * Unlike simulate, which runs the protocol each round really ran, the default
 * protocol is `latest`: pass `protocol: 'round'` for the chain's own rules.
 */
export class QueryRequest implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        {
          key: 'program',
          valueSchema: new OptionalSchema(new ByteArraySchema()),
          omitEmpty: true,
        },
        {
          key: 'clear-program',
          valueSchema: new OptionalSchema(new ByteArraySchema()),
          omitEmpty: true,
        },
        {
          key: 'global-schema',
          valueSchema: new OptionalSchema(
            ApplicationStateSchema.encodingSchema
          ),
          omitEmpty: true,
        },
        {
          key: 'local-schema',
          valueSchema: new OptionalSchema(
            ApplicationStateSchema.encodingSchema
          ),
          omitEmpty: true,
        },
        {
          key: 'app-id',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'sender',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
        {
          key: 'rounds',
          valueSchema: new OptionalSchema(new ArraySchema(new Uint64Schema())),
          omitEmpty: true,
        },
        {
          key: 'protocol',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
        {
          key: 'budget',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'calls',
          valueSchema: new ArraySchema(QueryCall.encodingSchema),
          omitEmpty: false,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The approval program of the app each call creates. Extra program pages
   * follow from its length. Not with `appId`.
   */
  public program?: Uint8Array;

  /**
   * The clear state program of the app each call creates. Defaults to
   * `pushint 1` at the version of `program`, which must then be v3 or later.
   * Only with `program`.
   */
  public clearProgram?: Uint8Array;

  /** The global state schema of the app each call creates. Only with `program`. */
  public globalSchema?: ApplicationStateSchema;

  /** The local state schema of the app each call creates. Only with `program`. */
  public localSchema?: ApplicationStateSchema;

  /** The deployed app each call calls, with OnCompletion NoOp. Not with `program`. */
  public appId?: bigint;

  /** The sender of every call. Defaults to the fee sink of the queried round. */
  public sender?: Address;

  /**
   * The rounds to query, at most the node's `maxRounds` entries, duplicates
   * included, and at most its `maxTotalCalls` divided by the calls; 0 is the
   * latest round. Defaults to the latest round. A round after the latest one
   * fails the request.
   */
  public rounds?: bigint[];

  /**
   * The protocol the block after each queried round runs: `latest` (the
   * default), a consensus version or `vNN` name of a later protocol, or
   * `round` for the protocol the chain really ran. `future` needs the node's
   * developer API.
   */
  public protocol?: string;

  /**
   * The opcode budget of each call, shared by the app it runs and the apps it
   * calls. Defaults to, and may be at most, the node's `maxCallBudget`.
   */
  public budget?: number;

  /**
   * The calls, at most the node's `maxCalls`, and at most its `maxTotalCalls`
   * divided by the entries of `rounds` (1 without rounds).
   */
  public calls: QueryCall[];

  /**
   * Creates a new `QueryRequest` object.
   * @param program - The approval program of the app each call creates, as
   * bytes or base64 (as `compile().do()` returns it).
   * @param clearProgram - Its clear state program, as bytes or base64.
   * @param globalSchema - Its global state schema.
   * @param localSchema - Its local state schema.
   * @param appId - The deployed app each call calls instead.
   * @param sender - The sender of every call.
   * @param rounds - The rounds to query; 0 is the latest.
   * @param protocol - The protocol to run under; defaults to `latest`.
   * @param budget - The opcode budget of each call.
   * @param calls - The calls, as models or plain objects.
   */
  constructor({
    program,
    clearProgram,
    globalSchema,
    localSchema,
    appId,
    sender,
    rounds,
    protocol,
    budget,
    calls,
  }: {
    program?: string | Uint8Array;
    clearProgram?: string | Uint8Array;
    globalSchema?: StateSchemaParams;
    localSchema?: StateSchemaParams;
    appId?: number | bigint;
    sender?: string | Address;
    rounds?: (number | bigint)[];
    protocol?: string;
    budget?: number | bigint;
    calls: (QueryCall | QueryCallParams)[];
  }) {
    this.program =
      typeof program === 'string' ? base64ToBytes(program) : program;
    this.clearProgram =
      typeof clearProgram === 'string'
        ? base64ToBytes(clearProgram)
        : clearProgram;
    this.globalSchema = toStateSchema(globalSchema);
    this.localSchema = toStateSchema(localSchema);
    this.appId = typeof appId === 'undefined' ? undefined : ensureUint64(appId);
    this.sender =
      typeof sender === 'string' ? Address.fromString(sender) : sender;
    this.rounds =
      typeof rounds === 'undefined' ? undefined : rounds.map(ensureUint64);
    this.protocol = protocol;
    this.budget =
      typeof budget === 'undefined' ? undefined : ensureSafeInteger(budget);
    this.calls = calls.map((c) =>
      c instanceof QueryCall ? c : new QueryCall(c)
    );
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return QueryRequest.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['program', this.program],
      ['clear-program', this.clearProgram],
      [
        'global-schema',
        typeof this.globalSchema !== 'undefined'
          ? this.globalSchema.toEncodingData()
          : undefined,
      ],
      [
        'local-schema',
        typeof this.localSchema !== 'undefined'
          ? this.localSchema.toEncodingData()
          : undefined,
      ],
      ['app-id', this.appId],
      [
        'sender',
        typeof this.sender !== 'undefined' ? this.sender.toString() : undefined,
      ],
      ['rounds', this.rounds],
      ['protocol', this.protocol],
      ['budget', this.budget],
      ['calls', this.calls.map((v) => v.toEncodingData())],
    ]);
  }

  static fromEncodingData(data: unknown): QueryRequest {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded QueryRequest: ${data}`);
    }
    return new QueryRequest({
      program: data.get('program'),
      clearProgram: data.get('clear-program'),
      globalSchema:
        typeof data.get('global-schema') !== 'undefined'
          ? ApplicationStateSchema.fromEncodingData(data.get('global-schema'))
          : undefined,
      localSchema:
        typeof data.get('local-schema') !== 'undefined'
          ? ApplicationStateSchema.fromEncodingData(data.get('local-schema'))
          : undefined,
      appId: data.get('app-id'),
      sender: data.get('sender'),
      rounds: data.get('rounds'),
      protocol: data.get('protocol'),
      budget: data.get('budget'),
      calls: (data.get('calls') ?? []).map((v: unknown) =>
        QueryCall.fromEncodingData(v)
      ),
    });
  }
}

/** What {@link QueryRequest}'s constructor takes. */
export type QueryRequestParams = ConstructorParameters<typeof QueryRequest>[0];

/**
 * The result of one call of a query at one round.
 */
export class QueryCallResult implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        {
          key: 'logs',
          valueSchema: new ArraySchema(new ByteArraySchema()),
          omitEmpty: true,
        },
        { key: 'cost', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'error',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The logs of the called app, also when the call failed part way. Logs of
   * the apps it called are not included.
   */
  public logs: Uint8Array[];

  /** The opcode budget the call used, the apps it called included. */
  public cost: number;

  /**
   * The call's error, if it failed: the bare evaluation error, such as
   * `logic eval error: ...`, without simulate's `transaction N:` prefix.
   */
  public error?: string;

  /**
   * Creates a new `QueryCallResult` object.
   * @param logs - The logs of the called app.
   * @param cost - The opcode budget the call used.
   * @param error - The call's error, if it failed.
   */
  constructor({
    logs,
    cost,
    error,
  }: {
    logs: Uint8Array[];
    cost: number | bigint;
    error?: string;
  }) {
    this.logs = logs;
    this.cost = ensureSafeInteger(cost);
    this.error = error;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return QueryCallResult.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['logs', this.logs],
      ['cost', this.cost],
      ['error', this.error],
    ]);
  }

  static fromEncodingData(data: unknown): QueryCallResult {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded QueryCallResult: ${data}`);
    }
    return new QueryCallResult({
      logs: data.get('logs') ?? [],
      cost: data.get('cost') ?? 0,
      error: data.get('error'),
    });
  }
}

/**
 * The calls of a query at one round: one entry of
 * {@link QueryResponse.rounds}.
 */
export class QueryRoundResult implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'protocol',
          valueSchema: new OptionalSchema(QueryProtocolOverride.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'error',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
        {
          key: 'calls',
          valueSchema: new ArraySchema(QueryCallResult.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The queried round, with 0 resolved to the latest round: the calls ran in
   * the block after it, on the state it left.
   */
  public round: bigint;

  /**
   * How the protocol applied at this round (wire key `protocol`; named
   * `protocolOverride` so as not to be confused with the request's
   * `protocol` string). Set when another
   * protocol than the round's own applied, which is the default (`latest`)
   * for any round before the latest protocol upgrade, and whenever the
   * request set `protocol`, except `round`.
   */
  public protocolOverride?: QueryProtocolOverride;

  /** Why the round could not be queried. There are no calls then. */
  public error?: string;

  /** One result per call of the request, in order. Empty when `error` is set. */
  public calls: QueryCallResult[];

  /**
   * Creates a new `QueryRoundResult` object.
   * @param round - The queried round.
   * @param protocolOverride - How the protocol applied at this round.
   * @param error - Why the round could not be queried.
   * @param calls - One result per call of the request.
   */
  constructor({
    round,
    protocolOverride,
    error,
    calls,
  }: {
    round: number | bigint;
    protocolOverride?: QueryProtocolOverride;
    error?: string;
    calls: QueryCallResult[];
  }) {
    this.round = ensureBigInt(round);
    this.protocolOverride = protocolOverride;
    this.error = error;
    this.calls = calls;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return QueryRoundResult.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      [
        'protocol',
        typeof this.protocolOverride !== 'undefined'
          ? this.protocolOverride.toEncodingData()
          : undefined,
      ],
      ['error', this.error],
      ['calls', this.calls.map((v) => v.toEncodingData())],
    ]);
  }

  static fromEncodingData(data: unknown): QueryRoundResult {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded QueryRoundResult: ${data}`);
    }
    return new QueryRoundResult({
      round: data.get('round') ?? 0,
      protocolOverride:
        typeof data.get('protocol') !== 'undefined'
          ? QueryProtocolOverride.fromEncodingData(data.get('protocol'))
          : undefined,
      error: data.get('error'),
      calls: (data.get('calls') ?? []).map((v: unknown) =>
        QueryCallResult.fromEncodingData(v)
      ),
    });
  }
}

/**
 * The response of `POST /v2/query` (`DTAlgodClient.query`): one entry in
 * `rounds` per entry of the request's `rounds`, in order (one for the latest
 * round when it listed none), each with one result per call, in order.
 *
 * #### Example
 * ```typescript
 * const res = await algodClient.query(request).do();
 * res.rounds.forEach((r, i) => {
 *   r.calls.forEach((c, j) => {
 *     console.log(r.round, j, r.error ?? c.error ?? c.logs);
 *   });
 * });
 * ```
 */
export class QueryResponse implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'last-round', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'rounds',
          valueSchema: new ArraySchema(QueryRoundResult.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** The node's latest round when the request started. */
  public lastRound: bigint;

  /** One result per entry of the request's `rounds`, in order. */
  public rounds: QueryRoundResult[];

  /**
   * Creates a new `QueryResponse` object.
   * @param lastRound - The node's latest round when the request started.
   * @param rounds - One result per entry of the request's `rounds`.
   */
  constructor({
    lastRound,
    rounds,
  }: {
    lastRound: number | bigint;
    rounds: QueryRoundResult[];
  }) {
    this.lastRound = ensureBigInt(lastRound);
    this.rounds = rounds;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return QueryResponse.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['last-round', this.lastRound],
      ['rounds', this.rounds.map((v) => v.toEncodingData())],
    ]);
  }

  static fromEncodingData(data: unknown): QueryResponse {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded QueryResponse: ${data}`);
    }
    return new QueryResponse({
      lastRound: data.get('last-round') ?? 0,
      rounds: (data.get('rounds') ?? []).map((v: unknown) =>
        QueryRoundResult.fromEncodingData(v)
      ),
    });
  }
}

/**
 * An account that holds an asset, and its holding.
 */
export class AssetHolder implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'address', valueSchema: new StringSchema(), omitEmpty: true },
        { key: 'amount', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'is-frozen', valueSchema: new BooleanSchema(), omitEmpty: true }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The holder's address. A string, as `Account.address` is: decoding a page
   * of 10,000 holders into `Address` objects would check 10,000 checksums.
   */
  public address: string;

  /**
   * \[a\] number of units held.
   */
  public amount: bigint;

  /**
   * \[f\] whether or not the holding is frozen.
   */
  public isFrozen: boolean;

  /**
   * Creates a new `AssetHolder` object.
   * @param address - The holder's address.
   * @param amount - \[a\] number of units held.
   * @param isFrozen - \[f\] whether or not the holding is frozen.
   */
  constructor({
    address,
    amount,
    isFrozen,
  }: {
    address: string | Address;
    amount: number | bigint;
    isFrozen: boolean;
  }) {
    this.address = address.toString();
    this.amount = ensureBigInt(amount);
    this.isFrozen = isFrozen;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AssetHolder.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['address', this.address],
      ['amount', this.amount],
      ['is-frozen', this.isFrozen],
    ]);
  }

  static fromEncodingData(data: unknown): AssetHolder {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AssetHolder: ${data}`);
    }
    return new AssetHolder({
      address: data.get('address'),
      amount: data.get('amount'),
      isFrozen: data.get('is-frozen'),
    });
  }
}

/**
 * Holders of an asset at a round.
 */
export class AssetHoldersResponse implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'next-token',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
        {
          key: 'holders',
          valueSchema: new ArraySchema(AssetHolder.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The round of the holdings: `round`, or the latest round.
   */
  public round: bigint;

  /**
   * Present if more holders may remain: provide it as the `next` parameter,
   * with the same round, to get them.
   */
  public nextToken?: string;

  /**
   * The holders, in address order.
   */
  public holders: AssetHolder[];

  /**
   * Creates a new `AssetHoldersResponse` object.
   * @param round - The round of the holdings: `round`, or the latest round.
   * @param nextToken - Present if more holders may remain.
   * @param holders - The holders, in address order.
   */
  constructor({
    round,
    nextToken,
    holders,
  }: {
    round: number | bigint;
    nextToken?: string;
    holders: AssetHolder[];
  }) {
    this.round = ensureBigInt(round);
    this.nextToken = nextToken;
    this.holders = holders;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AssetHoldersResponse.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['next-token', this.nextToken],
      ['holders', this.holders.map((h) => h.toEncodingData())],
    ]);
  }

  static fromEncodingData(data: unknown): AssetHoldersResponse {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AssetHoldersResponse: ${data}`);
    }
    return new AssetHoldersResponse({
      round: data.get('round'),
      nextToken: data.get('next-token'),
      holders: (data.get('holders') ?? []).map((h: unknown) =>
        AssetHolder.fromEncodingData(h)
      ),
    });
  }
}

/**
 * An app state key a transaction changed, with its value before and after the
 * transaction (net over it and its inner transactions).
 *
 * A missing `before`: the key did not exist. A missing `after`: the key was
 * deleted, its local state cleared (CloseOut, ClearState), or its app deleted
 * (globals only: the boxes of a deleted app stay). A box's value is the whole
 * box, as `bytes`.
 */
export class AppStateChange implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'app-id', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'app-state-type',
          valueSchema: new StringSchema(),
          omitEmpty: true,
        },
        {
          key: 'account',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
        { key: 'key', valueSchema: new ByteArraySchema(), omitEmpty: true },
        {
          key: 'before',
          valueSchema: new OptionalSchema(TealValue.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'after',
          valueSchema: new OptionalSchema(TealValue.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** The app whose state changed. */
  public appId: bigint;

  /**
   * The kind of state: `g` global state, `l` local state, `b` a box. A value
   * this client does not know is kept as the node sent it.
   */
  public appStateType: string;

  /** For a local state change, the account whose local state changed. */
  public account?: Address;

  /** The global or local state key, or the box name. */
  public key: Uint8Array;

  /** The value before the transaction; undefined if the key did not exist. */
  public before?: TealValue;

  /**
   * The value after the transaction; undefined if the key was deleted, its
   * local state cleared, or its app deleted.
   */
  public after?: TealValue;

  /**
   * Creates a new `AppStateChange` object.
   * @param appId - The app whose state changed.
   * @param appStateType - `g` global state, `l` local state, `b` a box.
   * @param account - For a local state change, the account.
   * @param key - The state key or box name (bytes, or base64).
   * @param before - The value before; undefined if the key did not exist.
   * @param after - The value after; undefined if the key is gone.
   */
  constructor({
    appId,
    appStateType,
    account,
    key,
    before,
    after,
  }: {
    appId: number | bigint;
    appStateType: string;
    account?: Address | string;
    key: string | Uint8Array;
    before?: TealValue;
    after?: TealValue;
  }) {
    this.appId = ensureBigInt(appId);
    this.appStateType = appStateType;
    this.account =
      typeof account === 'string' ? Address.fromString(account) : account;
    this.key = typeof key === 'string' ? base64ToBytes(key) : key;
    this.before = before;
    this.after = after;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AppStateChange.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['app-id', this.appId],
      ['app-state-type', this.appStateType],
      [
        'account',
        typeof this.account !== 'undefined'
          ? this.account.toString()
          : undefined,
      ],
      ['key', this.key],
      [
        'before',
        typeof this.before !== 'undefined'
          ? this.before.toEncodingData()
          : undefined,
      ],
      [
        'after',
        typeof this.after !== 'undefined'
          ? this.after.toEncodingData()
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): AppStateChange {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AppStateChange: ${data}`);
    }
    const value = (v: unknown) =>
      typeof v !== 'undefined' ? TealValue.fromEncodingData(v) : undefined;
    return new AppStateChange({
      appId: data.get('app-id'),
      appStateType: data.get('app-state-type'),
      account: data.get('account'),
      key: data.get('key'),
      before: value(data.get('before')),
      after: value(data.get('after')),
    });
  }
}

/**
 * The app state changes of a transaction of a round, top-level or inner, net
 * over it and its inner transactions.
 */
export class TxnStateChanges implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        {
          key: 'path',
          valueSchema: new ArraySchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'txid',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
        {
          key: 'changes',
          valueSchema: new ArraySchema(AppStateChange.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * Where the transaction is: its index in the block's payset, then, for an
   * inner transaction, its index among its parent's inner transactions at
   * each level. Inner indexes run on across all of a parent's `itxn_submit`
   * calls, as in the apply data's inner transactions.
   */
  public path: number[];

  /** The transaction ID, for a top-level transaction (`path` of length 1). */
  public txid?: string;

  /** The keys the transaction changed, in the order it first changed them. */
  public changes: AppStateChange[];

  /**
   * Creates a new `TxnStateChanges` object.
   * @param path - The payset index, then the inner indexes.
   * @param txid - The transaction ID, for a top-level transaction.
   * @param changes - The keys the transaction changed.
   */
  constructor({
    path,
    txid,
    changes,
  }: {
    path: (number | bigint)[];
    txid?: string;
    changes: AppStateChange[];
  }) {
    this.path = path.map(ensureSafeInteger);
    this.txid = txid;
    this.changes = changes;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return TxnStateChanges.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['path', this.path],
      ['txid', this.txid],
      ['changes', this.changes.map((c) => c.toEncodingData())],
    ]);
  }

  static fromEncodingData(data: unknown): TxnStateChanges {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded TxnStateChanges: ${data}`);
    }
    return new TxnStateChanges({
      path: data.get('path') ?? [],
      txid: data.get('txid'),
      changes: (data.get('changes') ?? []).map((c: unknown) =>
        AppStateChange.fromEncodingData(c)
      ),
    });
  }
}

/**
 * `before`/`after` entries of a change, both optional, and kept when present
 * even with every field zero.
 */
function changeValueEntries(valueSchema: Schema) {
  return [
    {
      key: 'before',
      valueSchema: new PresentOptionalSchema(valueSchema),
      omitEmpty: true,
    },
    {
      key: 'after',
      valueSchema: new PresentOptionalSchema(valueSchema),
      omitEmpty: true,
    },
  ];
}

/** Decodes an optional model value: undefined (or null) stays undefined. */
function optionalModel<T>(
  v: unknown,
  fromEncodingData: (data: unknown) => T
): T | undefined {
  return v === undefined || v === null ? undefined : fromEncodingData(v);
}

/**
 * An account's own fields between two groups of a round
 * ({@link AccountStateChange}): the scalar fields of {@link Account} under the same
 * names and types, so code that reads an `Account` reads it the same way,
 * except `rewards`, which is optional here and has no pending rewards.
 * `Account`'s `round`, `pending-rewards` and `amount-without-pending-rewards`
 * have no meaning between two groups and are left out, as are its lists
 * (holdings, local states, created assets and apps), whose changes are in the
 * group's other lists.
 */
export class AccountState implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'amount', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'min-balance',
          valueSchema: new Uint64Schema(),
          omitEmpty: true,
        },
        { key: 'status', valueSchema: new StringSchema(), omitEmpty: true },
        {
          key: 'total-apps-opted-in',
          valueSchema: new Uint64Schema(),
          omitEmpty: true,
        },
        {
          key: 'total-assets-opted-in',
          valueSchema: new Uint64Schema(),
          omitEmpty: true,
        },
        {
          key: 'total-created-apps',
          valueSchema: new Uint64Schema(),
          omitEmpty: true,
        },
        {
          key: 'total-created-assets',
          valueSchema: new Uint64Schema(),
          omitEmpty: true,
        },
        {
          key: 'apps-total-extra-pages',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'apps-total-schema',
          valueSchema: new OptionalSchema(
            ApplicationStateSchema.encodingSchema
          ),
          omitEmpty: true,
        },
        {
          key: 'auth-addr',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
        {
          key: 'incentive-eligible',
          valueSchema: new OptionalSchema(new BooleanSchema()),
          omitEmpty: true,
        },
        {
          key: 'last-heartbeat',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'last-proposed',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'participation',
          valueSchema: new OptionalSchema(AccountParticipation.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'reward-base',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'rewards',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'total-box-bytes',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        {
          key: 'total-boxes',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** The balance in microAlgos, as recorded: rewards already applied. */
  public amount: bigint;

  /**
   * The minimum balance in microAlgos, with the round's consensus params, as
   * `/v2/accounts` computes it.
   */
  public minBalance: bigint;

  /** `Offline`, `Online` or `Not Participating`. */
  public status: string;

  /** The number of apps the account is opted in to. */
  public totalAppsOptedIn: number;

  /** The number of assets the account is opted in to. */
  public totalAssetsOptedIn: number;

  /** The number of apps the account created. */
  public totalCreatedApps: number;

  /** The number of assets the account created. */
  public totalCreatedAssets: number;

  /** The extra program pages of the apps the account created. */
  public appsTotalExtraPages?: number;

  /** The local and global state schemas the account's apps take. */
  public appsTotalSchema?: ApplicationStateSchema;

  /** The address the account is rekeyed to. */
  public authAddr?: Address;

  /** Whether the account is eligible for block incentives. */
  public incentiveEligible?: boolean;

  /** The last round the account sent a heartbeat. */
  public lastHeartbeat?: number;

  /** The last round the account proposed a block. */
  public lastProposed?: number;

  /** The account's participation keys, when it registered them. */
  public participation?: AccountParticipation;

  /** The rewards level the account's rewards were last applied at. */
  public rewardBase?: bigint;

  /**
   * The rewards in microAlgos the account has received in all, already in
   * `amount` (`Account.rewards` without pending rewards).
   */
  public rewards?: bigint;

  /** The bytes of the boxes the account's apps hold (names and values). */
  public totalBoxBytes?: number;

  /** The number of boxes the account's apps hold. */
  public totalBoxes?: number;

  /**
   * Creates a new `AccountState` object. The parameters are the fields of the
   * same name.
   */
  constructor({
    amount,
    minBalance,
    status,
    totalAppsOptedIn,
    totalAssetsOptedIn,
    totalCreatedApps,
    totalCreatedAssets,
    appsTotalExtraPages,
    appsTotalSchema,
    authAddr,
    incentiveEligible,
    lastHeartbeat,
    lastProposed,
    participation,
    rewardBase,
    rewards,
    totalBoxBytes,
    totalBoxes,
  }: {
    amount: number | bigint;
    minBalance: number | bigint;
    status: string;
    totalAppsOptedIn: number | bigint;
    totalAssetsOptedIn: number | bigint;
    totalCreatedApps: number | bigint;
    totalCreatedAssets: number | bigint;
    appsTotalExtraPages?: number | bigint;
    appsTotalSchema?: ApplicationStateSchema;
    authAddr?: Address | string;
    incentiveEligible?: boolean;
    lastHeartbeat?: number | bigint;
    lastProposed?: number | bigint;
    participation?: AccountParticipation;
    rewardBase?: number | bigint;
    rewards?: number | bigint;
    totalBoxBytes?: number | bigint;
    totalBoxes?: number | bigint;
  }) {
    const safe = (v?: number | bigint) =>
      typeof v === 'undefined' ? undefined : ensureSafeInteger(v);
    this.amount = ensureBigInt(amount);
    this.minBalance = ensureBigInt(minBalance);
    this.status = status;
    this.totalAppsOptedIn = ensureSafeInteger(totalAppsOptedIn);
    this.totalAssetsOptedIn = ensureSafeInteger(totalAssetsOptedIn);
    this.totalCreatedApps = ensureSafeInteger(totalCreatedApps);
    this.totalCreatedAssets = ensureSafeInteger(totalCreatedAssets);
    this.appsTotalExtraPages = safe(appsTotalExtraPages);
    this.appsTotalSchema = appsTotalSchema;
    this.authAddr =
      typeof authAddr === 'string' ? Address.fromString(authAddr) : authAddr;
    this.incentiveEligible = incentiveEligible;
    this.lastHeartbeat = safe(lastHeartbeat);
    this.lastProposed = safe(lastProposed);
    this.participation = participation;
    this.rewardBase =
      typeof rewardBase === 'undefined' ? undefined : ensureBigInt(rewardBase);
    this.rewards =
      typeof rewards === 'undefined' ? undefined : ensureBigInt(rewards);
    this.totalBoxBytes = safe(totalBoxBytes);
    this.totalBoxes = safe(totalBoxes);
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AccountState.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['amount', this.amount],
      ['min-balance', this.minBalance],
      ['status', this.status],
      ['total-apps-opted-in', this.totalAppsOptedIn],
      ['total-assets-opted-in', this.totalAssetsOptedIn],
      ['total-created-apps', this.totalCreatedApps],
      ['total-created-assets', this.totalCreatedAssets],
      ['apps-total-extra-pages', this.appsTotalExtraPages],
      ['apps-total-schema', this.appsTotalSchema?.toEncodingData()],
      ['auth-addr', this.authAddr?.toString()],
      ['incentive-eligible', this.incentiveEligible],
      ['last-heartbeat', this.lastHeartbeat],
      ['last-proposed', this.lastProposed],
      ['participation', this.participation?.toEncodingData()],
      ['reward-base', this.rewardBase],
      ['rewards', this.rewards],
      ['total-box-bytes', this.totalBoxBytes],
      ['total-boxes', this.totalBoxes],
    ]);
  }

  static fromEncodingData(data: unknown): AccountState {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AccountState: ${data}`);
    }
    return new AccountState({
      amount: data.get('amount'),
      minBalance: data.get('min-balance'),
      status: data.get('status'),
      totalAppsOptedIn: data.get('total-apps-opted-in'),
      totalAssetsOptedIn: data.get('total-assets-opted-in'),
      totalCreatedApps: data.get('total-created-apps'),
      totalCreatedAssets: data.get('total-created-assets'),
      appsTotalExtraPages: data.get('apps-total-extra-pages'),
      appsTotalSchema: optionalModel(
        data.get('apps-total-schema'),
        ApplicationStateSchema.fromEncodingData
      ),
      authAddr: data.get('auth-addr'),
      incentiveEligible: data.get('incentive-eligible'),
      lastHeartbeat: data.get('last-heartbeat'),
      lastProposed: data.get('last-proposed'),
      participation: optionalModel(
        data.get('participation'),
        AccountParticipation.fromEncodingData
      ),
      rewardBase: data.get('reward-base'),
      rewards: data.get('rewards'),
      totalBoxBytes: data.get('total-box-bytes'),
      totalBoxes: data.get('total-boxes'),
    });
  }
}

/**
 * An account a group changed, with its own fields before and after the group.
 * A missing `before`: the account did not exist (it was funded by the group).
 * A missing `after`: the group closed it.
 */
export class AccountStateChange implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'address', valueSchema: new StringSchema(), omitEmpty: true },
        ...changeValueEntries(AccountState.encodingSchema)
      );
    }
    return this.encodingSchemaValue;
  }

  /** The account. */
  public address: Address;

  /** The account before the group; undefined if it did not exist. */
  public before?: AccountState;

  /** The account after the group; undefined if the group closed it. */
  public after?: AccountState;

  /**
   * Creates a new `AccountStateChange` object.
   * @param address - The account.
   * @param before - The account before the group; undefined if new.
   * @param after - The account after the group; undefined if closed.
   */
  constructor({
    address,
    before,
    after,
  }: {
    address: Address | string;
    before?: AccountState;
    after?: AccountState;
  }) {
    this.address =
      typeof address === 'string' ? Address.fromString(address) : address;
    this.before = before;
    this.after = after;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AccountStateChange.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['address', this.address.toString()],
      ['before', this.before?.toEncodingData()],
      ['after', this.after?.toEncodingData()],
    ]);
  }

  static fromEncodingData(data: unknown): AccountStateChange {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AccountStateChange: ${data}`);
    }
    return new AccountStateChange({
      address: data.get('address'),
      before: optionalModel(data.get('before'), AccountState.fromEncodingData),
      after: optionalModel(data.get('after'), AccountState.fromEncodingData),
    });
  }
}

/**
 * An asset holding a group changed, with the holding before and after the
 * group. A missing `before`: the group opted the account in. A missing
 * `after`: the group opted it out.
 */
export class AssetHoldingChange implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'address', valueSchema: new StringSchema(), omitEmpty: true },
        { key: 'asset-id', valueSchema: new Uint64Schema(), omitEmpty: true },
        ...changeValueEntries(AssetHolding.encodingSchema)
      );
    }
    return this.encodingSchemaValue;
  }

  /** The holder. */
  public address: Address;

  /** The asset. */
  public assetId: bigint;

  /** The holding before the group; undefined if not opted in. */
  public before?: AssetHolding;

  /** The holding after the group; undefined if opted out. */
  public after?: AssetHolding;

  /**
   * Creates a new `AssetHoldingChange` object.
   * @param address - The holder.
   * @param assetId - The asset.
   * @param before - The holding before the group; undefined if opted in by it.
   * @param after - The holding after the group; undefined if opted out by it.
   */
  constructor({
    address,
    assetId,
    before,
    after,
  }: {
    address: Address | string;
    assetId: number | bigint;
    before?: AssetHolding;
    after?: AssetHolding;
  }) {
    this.address =
      typeof address === 'string' ? Address.fromString(address) : address;
    this.assetId = ensureBigInt(assetId);
    this.before = before;
    this.after = after;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AssetHoldingChange.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['address', this.address.toString()],
      ['asset-id', this.assetId],
      ['before', this.before?.toEncodingData()],
      ['after', this.after?.toEncodingData()],
    ]);
  }

  static fromEncodingData(data: unknown): AssetHoldingChange {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AssetHoldingChange: ${data}`);
    }
    return new AssetHoldingChange({
      address: data.get('address'),
      assetId: data.get('asset-id'),
      before: optionalModel(data.get('before'), AssetHolding.fromEncodingData),
      after: optionalModel(data.get('after'), AssetHolding.fromEncodingData),
    });
  }
}

/**
 * An asset whose params a group changed, with the params before and after the
 * group. A missing `before`: the group created the asset. A missing `after`:
 * the group destroyed it.
 */
export class AssetParamsChange implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'asset-id', valueSchema: new Uint64Schema(), omitEmpty: true },
        ...changeValueEntries(AssetParams.encodingSchema)
      );
    }
    return this.encodingSchemaValue;
  }

  /** The asset. */
  public assetId: bigint;

  /** The params before the group; undefined if the group created the asset. */
  public before?: AssetParams;

  /** The params after the group; undefined if the group destroyed it. */
  public after?: AssetParams;

  /**
   * Creates a new `AssetParamsChange` object.
   * @param assetId - The asset.
   * @param before - The params before the group; undefined if created by it.
   * @param after - The params after the group; undefined if destroyed by it.
   */
  constructor({
    assetId,
    before,
    after,
  }: {
    assetId: number | bigint;
    before?: AssetParams;
    after?: AssetParams;
  }) {
    this.assetId = ensureBigInt(assetId);
    this.before = before;
    this.after = after;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AssetParamsChange.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['asset-id', this.assetId],
      ['before', this.before?.toEncodingData()],
      ['after', this.after?.toEncodingData()],
    ]);
  }

  static fromEncodingData(data: unknown): AssetParamsChange {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AssetParamsChange: ${data}`);
    }
    return new AssetParamsChange({
      assetId: data.get('asset-id'),
      before: optionalModel(data.get('before'), AssetParams.fromEncodingData),
      after: optionalModel(data.get('after'), AssetParams.fromEncodingData),
    });
  }
}

/**
 * An app whose params a group changed, with the params before and after the
 * group, without `globalState` (global state changes are in the round's
 * `txns`): listed only when something else changed, such as the programs,
 * the schemas, the extra pages or the version. A missing `before`: the group
 * created the app. A missing `after`: the group deleted it.
 */
export class AppParamsChange implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'app-id', valueSchema: new Uint64Schema(), omitEmpty: true },
        ...changeValueEntries(ApplicationParams.encodingSchema)
      );
    }
    return this.encodingSchemaValue;
  }

  /** The app. */
  public appId: bigint;

  /** The params before the group; undefined if the group created the app. */
  public before?: ApplicationParams;

  /** The params after the group; undefined if the group deleted it. */
  public after?: ApplicationParams;

  /**
   * Creates a new `AppParamsChange` object.
   * @param appId - The app.
   * @param before - The params before the group; undefined if created by it.
   * @param after - The params after the group; undefined if deleted by it.
   */
  constructor({
    appId,
    before,
    after,
  }: {
    appId: number | bigint;
    before?: ApplicationParams;
    after?: ApplicationParams;
  }) {
    this.appId = ensureBigInt(appId);
    this.before = before;
    this.after = after;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AppParamsChange.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['app-id', this.appId],
      ['before', this.before?.toEncodingData()],
      ['after', this.after?.toEncodingData()],
    ]);
  }

  static fromEncodingData(data: unknown): AppParamsChange {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AppParamsChange: ${data}`);
    }
    return new AppParamsChange({
      appId: data.get('app-id'),
      before: optionalModel(
        data.get('before'),
        ApplicationParams.fromEncodingData
      ),
      after: optionalModel(
        data.get('after'),
        ApplicationParams.fromEncodingData
      ),
    });
  }
}

/**
 * A local state a group created or removed, before and after the group, as
 * an {@link ApplicationLocalState} with its `id` and `schema` and without
 * `keyValue` (the keys are in the round's `txns`). A missing `before`: the
 * group opted the account in to the app. A missing `after`: the group closed
 * it out or cleared it.
 */
export class LocalStateChange implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'address', valueSchema: new StringSchema(), omitEmpty: true },
        { key: 'app-id', valueSchema: new Uint64Schema(), omitEmpty: true },
        ...changeValueEntries(ApplicationLocalState.encodingSchema)
      );
    }
    return this.encodingSchemaValue;
  }

  /** The account. */
  public address: Address;

  /** The app. */
  public appId: bigint;

  /** The local state before the group; undefined if not opted in. */
  public before?: ApplicationLocalState;

  /** The local state after the group; undefined if closed out or cleared. */
  public after?: ApplicationLocalState;

  /**
   * Creates a new `LocalStateChange` object.
   * @param address - The account.
   * @param appId - The app.
   * @param before - The local state before the group; undefined if opted in by it.
   * @param after - The local state after the group; undefined if removed by it.
   */
  constructor({
    address,
    appId,
    before,
    after,
  }: {
    address: Address | string;
    appId: number | bigint;
    before?: ApplicationLocalState;
    after?: ApplicationLocalState;
  }) {
    this.address =
      typeof address === 'string' ? Address.fromString(address) : address;
    this.appId = ensureBigInt(appId);
    this.before = before;
    this.after = after;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return LocalStateChange.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['address', this.address.toString()],
      ['app-id', this.appId],
      ['before', this.before?.toEncodingData()],
      ['after', this.after?.toEncodingData()],
    ]);
  }

  static fromEncodingData(data: unknown): LocalStateChange {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded LocalStateChange: ${data}`);
    }
    return new LocalStateChange({
      address: data.get('address'),
      appId: data.get('app-id'),
      before: optionalModel(
        data.get('before'),
        ApplicationLocalState.fromEncodingData
      ),
      after: optionalModel(
        data.get('after'),
        ApplicationLocalState.fromEncodingData
      ),
    });
  }
}

/**
 * What a top-level group of a round changed, other than app state, with each
 * value before and after the group: the state right before it in the round,
 * and right after it. Only values that differ are listed, each list sorted by
 * address, then id. The group's app state changes are its transactions'
 * entries in the round's `txns` (`txnsOf`).
 *
 * The fee sink is listed in `accounts` like any account whenever the group
 * paid fees; `withoutFeeSink` drops it.
 *
 * Changes the block makes outside its transactions, such as the proposer
 * payout from the fee sink and the rewards pool's, are in no group.
 */
export class GroupStateChanges implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'first', valueSchema: new Uint64Schema(), omitEmpty: true },
        { key: 'count', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'group-id',
          valueSchema: new OptionalSchema(new ByteArraySchema()),
          omitEmpty: true,
        },
        {
          key: 'txids',
          valueSchema: new ArraySchema(new StringSchema()),
          omitEmpty: true,
        },
        {
          key: 'accounts',
          valueSchema: new ArraySchema(AccountStateChange.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'holdings',
          valueSchema: new ArraySchema(AssetHoldingChange.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'assets',
          valueSchema: new ArraySchema(AssetParamsChange.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'apps',
          valueSchema: new ArraySchema(AppParamsChange.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'local-states',
          valueSchema: new ArraySchema(LocalStateChange.encodingSchema),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The payset index of the group's first transaction: `path[0]` of its
   * transactions in `txns`.
   */
  public first: number;

  /**
   * The number of top-level transactions in the group, at payset indexes
   * `first` to `first + count - 1`.
   */
  public count: number;

  /** The group ID; undefined for a transaction not in a group. */
  public groupId?: Uint8Array;

  /** The group's top-level transaction IDs, in payset order. */
  public txids: string[];

  /** The accounts the group changed (`include` `accounts`). */
  public accounts: AccountStateChange[];

  /** The asset holdings the group changed (`include` `assets`). */
  public holdings: AssetHoldingChange[];

  /** The asset params the group changed (`include` `assets`). */
  public assets: AssetParamsChange[];

  /** The app params the group changed (`include` `apps`). */
  public apps: AppParamsChange[];

  /** The local states the group created or removed (`include` `apps`). */
  public localStates: LocalStateChange[];

  /**
   * Creates a new `GroupStateChanges` object. The parameters are the fields of the
   * same name; the lists default to empty.
   */
  constructor({
    first,
    count,
    groupId,
    txids,
    accounts = [],
    holdings = [],
    assets = [],
    apps = [],
    localStates = [],
  }: {
    first: number | bigint;
    count: number | bigint;
    groupId?: string | Uint8Array;
    txids: string[];
    accounts?: AccountStateChange[];
    holdings?: AssetHoldingChange[];
    assets?: AssetParamsChange[];
    apps?: AppParamsChange[];
    localStates?: LocalStateChange[];
  }) {
    this.first = ensureSafeInteger(first);
    this.count = ensureSafeInteger(count);
    this.groupId =
      typeof groupId === 'string' ? base64ToBytes(groupId) : groupId;
    this.txids = txids;
    this.accounts = accounts;
    this.holdings = holdings;
    this.assets = assets;
    this.apps = apps;
    this.localStates = localStates;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return GroupStateChanges.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['first', this.first],
      ['count', this.count],
      ['group-id', this.groupId],
      ['txids', this.txids],
      ['accounts', this.accounts.map((c) => c.toEncodingData())],
      ['holdings', this.holdings.map((c) => c.toEncodingData())],
      ['assets', this.assets.map((c) => c.toEncodingData())],
      ['apps', this.apps.map((c) => c.toEncodingData())],
      ['local-states', this.localStates.map((c) => c.toEncodingData())],
    ]);
  }

  static fromEncodingData(data: unknown): GroupStateChanges {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded GroupStateChanges: ${data}`);
    }
    const list = <T>(key: string, from: (d: unknown) => T): T[] =>
      (data.get(key) ?? []).map((d: unknown) => from(d));
    return new GroupStateChanges({
      first: data.get('first') ?? 0,
      count: data.get('count') ?? 0,
      groupId: data.get('group-id'),
      txids: data.get('txids') ?? [],
      accounts: list('accounts', AccountStateChange.fromEncodingData),
      holdings: list('holdings', AssetHoldingChange.fromEncodingData),
      assets: list('assets', AssetParamsChange.fromEncodingData),
      apps: list('apps', AppParamsChange.fromEncodingData),
      localStates: list('local-states', LocalStateChange.fromEncodingData),
    });
  }
}

/**
 * A signed integer that fits a JavaScript number (Go's `int`), such as
 * {@link ProgramBudget.budgetAfter}, which is negative for a clear state
 * program that ran out of budget. {@link Uint64Schema} refuses negatives.
 */
class SafeIntegerSchema extends Uint64Schema {
  // eslint-disable-next-line class-methods-use-this
  public prepareMsgpack(data: unknown): MsgpackEncodingData {
    return ensureSafeInteger(data);
  }

  // eslint-disable-next-line class-methods-use-this
  public fromPreparedMsgpack(
    encoded: MsgpackEncodingData,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _rawStringProvider: MsgpackRawStringProvider
  ): bigint {
    return BigInt(ensureSafeInteger(encoded));
  }

  // eslint-disable-next-line class-methods-use-this
  public prepareJSON(data: unknown): JSONEncodingData {
    return ensureSafeInteger(data);
  }

  // eslint-disable-next-line class-methods-use-this
  public fromPreparedJSON(encoded: JSONEncodingData): bigint {
    return BigInt(ensureSafeInteger(encoded));
  }
}

/**
 * What a program run is: `approval` an app's approval program, `clear` its
 * clear state program, `logic-sig` a logic sig. A value this client does not
 * know is kept as the node sent it.
 */
export type ProgramKind = 'approval' | 'clear' | 'logic-sig';

/**
 * The opcode budget of one program run (`include(['budget'])`): an app's
 * approval or clear state program, top-level or inner, or a logic sig. The
 * programs of a transaction's inner transactions are entries of their own.
 */
export class ProgramBudget implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        {
          key: 'path',
          valueSchema: new ArraySchema(new Uint64Schema()),
          omitEmpty: false,
        },
        {
          key: 'txid',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
        { key: 'kind', valueSchema: new StringSchema(), omitEmpty: false },
        {
          key: 'app-id',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        { key: 'cost', valueSchema: new Uint64Schema(), omitEmpty: false },
        {
          key: 'budget-before',
          valueSchema: new SafeIntegerSchema(),
          omitEmpty: false,
        },
        {
          key: 'budget-after',
          valueSchema: new SafeIntegerSchema(),
          omitEmpty: false,
        },
        {
          key: 'failed',
          valueSchema: new OptionalSchema(new BooleanSchema()),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The transaction that ran the program: its index in the block's payset,
   * then its inner indexes, as {@link TxnStateChanges.path}.
   */
  public path: number[];

  /** The transaction ID, for a top-level transaction. */
  public txid?: string;

  /** `approval`, `clear` or `logic-sig`. */
  public kind: ProgramKind | string;

  /** For an app program, the app; for an app create, the new app. */
  public appId?: bigint;

  /** The opcode budget the program spent, without its inner transactions'. */
  public cost: number;

  /**
   * The opcode budget the program could still spend when it began: the
   * group's pool where budgets are pooled (apps', or logic sigs'), with what
   * an inner app call adds for itself; the program's own budget otherwise,
   * and at most that for a clear state program.
   */
  public budgetBefore: number;

  /**
   * The opcode budget the program could still spend when it ended. An inner
   * app call adds to the pool while its caller runs, so `budgetBefore`
   * minus `budgetAfter` can be less than `cost`. Negative for a clear state
   * program that ran out of budget.
   */
  public budgetAfter: number;

  /**
   * The program rejected or failed. In a block only a clear state program
   * can (or one inside it): the block keeps the call, without what the
   * program did.
   */
  public failed?: boolean;

  /**
   * Creates a new `ProgramBudget` object.
   * @param path - The payset index, then the inner indexes.
   * @param txid - The transaction ID, for a top-level transaction.
   * @param kind - `approval`, `clear` or `logic-sig`.
   * @param appId - The app, for an app program.
   * @param cost - The opcode budget the program spent.
   * @param budgetBefore - The budget it could spend when it began.
   * @param budgetAfter - The budget it could spend when it ended.
   * @param failed - The program rejected or failed.
   */
  constructor({
    path,
    txid,
    kind,
    appId,
    cost,
    budgetBefore,
    budgetAfter,
    failed,
  }: {
    path: (number | bigint)[];
    txid?: string;
    kind: ProgramKind | string;
    appId?: number | bigint;
    cost: number | bigint;
    budgetBefore: number | bigint;
    budgetAfter: number | bigint;
    failed?: boolean;
  }) {
    this.path = path.map(ensureSafeInteger);
    this.txid = txid;
    this.kind = kind;
    this.appId = typeof appId === 'undefined' ? undefined : ensureBigInt(appId);
    this.cost = ensureSafeInteger(cost);
    this.budgetBefore = ensureSafeInteger(budgetBefore);
    this.budgetAfter = ensureSafeInteger(budgetAfter);
    this.failed = failed;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return ProgramBudget.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['path', this.path],
      ['txid', this.txid],
      ['kind', this.kind],
      ['app-id', this.appId],
      ['cost', this.cost],
      ['budget-before', this.budgetBefore],
      ['budget-after', this.budgetAfter],
      ['failed', this.failed],
    ]);
  }

  static fromEncodingData(data: unknown): ProgramBudget {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded ProgramBudget: ${data}`);
    }
    return new ProgramBudget({
      path: data.get('path') ?? [],
      txid: data.get('txid'),
      kind: data.get('kind'),
      appId: data.get('app-id'),
      cost: data.get('cost') ?? 0,
      budgetBefore: data.get('budget-before') ?? 0,
      budgetAfter: data.get('budget-after') ?? 0,
      failed: data.get('failed'),
    });
  }
}

/**
 * An app state key a transaction read (`include(['reads'])`), with what it
 * read the first time: `value` for global and local state when the key
 * existed, `length` for a box. A key the transaction wrote before it read it
 * shows the value it wrote. Only the read opcodes count (`app_global_get(_ex)`,
 * `app_local_get(_ex)`, `box_get`, `box_extract`, `box_len`).
 */
export class AppStateRead implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'app-id', valueSchema: new Uint64Schema(), omitEmpty: false },
        {
          key: 'app-state-type',
          valueSchema: new StringSchema(),
          omitEmpty: false,
        },
        {
          key: 'account',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
        { key: 'key', valueSchema: new ByteArraySchema(), omitEmpty: false },
        { key: 'exists', valueSchema: new BooleanSchema(), omitEmpty: false },
        {
          key: 'value',
          valueSchema: new PresentOptionalSchema(TealValue.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'length',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** The app whose state was read. */
  public appId: bigint;

  /**
   * The kind of state: `g` global state, `l` local state, `b` a box. A value
   * this client does not know is kept as the node sent it.
   */
  public appStateType: string;

  /** For local state, the account whose local state was read. */
  public account?: Address;

  /** The global or local state key, or the box name. */
  public key: Uint8Array;

  /** The key existed (for a box, the box) when it was read. */
  public exists: boolean;

  /** For global and local state, the value read; undefined if none. */
  public value?: TealValue;

  /**
   * For a box, its length in bytes: 0 for an empty box and for one that did
   * not exist, which `exists` tells apart (the node leaves a 0 length out).
   * The value is not given. Undefined for global and local state.
   */
  public length?: number;

  /**
   * Creates a new `AppStateRead` object.
   * @param appId - The app whose state was read.
   * @param appStateType - `g` global state, `l` local state, `b` a box.
   * @param account - For local state, the account.
   * @param key - The state key or box name (bytes, or base64).
   * @param exists - The key existed when it was read.
   * @param value - For global and local state, the value read.
   * @param length - For a box, its length.
   */
  constructor({
    appId,
    appStateType,
    account,
    key,
    exists,
    value,
    length,
  }: {
    appId: number | bigint;
    appStateType: string;
    account?: Address | string;
    key: string | Uint8Array;
    exists: boolean;
    value?: TealValue;
    length?: number | bigint;
  }) {
    this.appId = ensureBigInt(appId);
    this.appStateType = appStateType;
    this.account =
      typeof account === 'string' ? Address.fromString(account) : account;
    this.key = typeof key === 'string' ? base64ToBytes(key) : key;
    this.exists = exists;
    this.value = value;
    this.length =
      typeof length === 'undefined' ? undefined : ensureSafeInteger(length);
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AppStateRead.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['app-id', this.appId],
      ['app-state-type', this.appStateType],
      ['account', this.account?.toString()],
      ['key', this.key],
      ['exists', this.exists],
      ['value', this.value?.toEncodingData()],
      // The node leaves a 0 length out.
      ['length', this.length === 0 ? undefined : this.length],
    ]);
  }

  static fromEncodingData(data: unknown): AppStateRead {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded AppStateRead: ${data}`);
    }
    const appStateType = data.get('app-state-type');
    return new AppStateRead({
      appId: data.get('app-id'),
      appStateType,
      account: data.get('account'),
      key: data.get('key'),
      exists: data.get('exists') ?? false,
      value: optionalModel(data.get('value'), (v) =>
        TealValue.fromEncodingData(v)
      ),
      // The node leaves a 0 length out; a box always has one.
      length: data.get('length') ?? (appStateType === 'b' ? 0 : undefined),
    });
  }
}

/**
 * The app state keys a transaction read (`include(['reads'])`), top-level or
 * inner. Its inner transactions' reads are entries of their own.
 */
export class TxnStateReads implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        {
          key: 'path',
          valueSchema: new ArraySchema(new Uint64Schema()),
          omitEmpty: false,
        },
        {
          key: 'txid',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
        {
          key: 'reads',
          valueSchema: new ArraySchema(AppStateRead.encodingSchema),
          omitEmpty: false,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The transaction: its index in the block's payset, then its inner
   * indexes, as {@link TxnStateChanges.path}.
   */
  public path: number[];

  /** The transaction ID, for a top-level transaction. */
  public txid?: string;

  /** The keys it read, each once, in the order it first read them. */
  public reads: AppStateRead[];

  /**
   * Creates a new `TxnStateReads` object.
   * @param path - The payset index, then the inner indexes.
   * @param txid - The transaction ID, for a top-level transaction.
   * @param reads - The keys it read.
   */
  constructor({
    path,
    txid,
    reads,
  }: {
    path: (number | bigint)[];
    txid?: string;
    reads: AppStateRead[];
  }) {
    this.path = path.map(ensureSafeInteger);
    this.txid = txid;
    this.reads = reads;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return TxnStateReads.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['path', this.path],
      ['txid', this.txid],
      ['reads', this.reads.map((r) => r.toEncodingData())],
    ]);
  }

  static fromEncodingData(data: unknown): TxnStateReads {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded TxnStateReads: ${data}`);
    }
    return new TxnStateReads({
      path: data.get('path') ?? [],
      txid: data.get('txid'),
      reads: (data.get('reads') ?? []).map((r: unknown) =>
        AppStateRead.fromEncodingData(r)
      ),
    });
  }
}

/**
 * The execution trace of a top-level transaction (`include(['trace'])`), as
 * simulate gives it with stack, scratch and state changes (each state change
 * with its `appId`). Empty for a transaction that ran no program.
 */
export class TxnExecTrace implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'txid', valueSchema: new StringSchema(), omitEmpty: false },
        {
          key: 'exec-trace',
          valueSchema: SimulationTransactionExecTrace.encodingSchema,
          omitEmpty: false,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** The transaction ID. */
  public txid: string;

  /**
   * The trace. Its program hashes (`approvalProgramHash`,
   * `clearStateProgramHash`, `logicSigHash`) are those of the answer's
   * `programs`; `programLine` maps a trace's `pc` to its line.
   */
  public execTrace: SimulationTransactionExecTrace;

  /**
   * Creates a new `TxnExecTrace` object.
   * @param txid - The transaction ID.
   * @param execTrace - The execution trace.
   */
  constructor({
    txid,
    execTrace,
  }: {
    txid: string;
    execTrace: SimulationTransactionExecTrace;
  }) {
    this.txid = txid;
    this.execTrace = execTrace;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return TxnExecTrace.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['txid', this.txid],
      ['exec-trace', this.execTrace.toEncodingData()],
    ]);
  }

  static fromEncodingData(data: unknown): TxnExecTrace {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded TxnExecTrace: ${data}`);
    }
    return new TxnExecTrace({
      txid: data.get('txid'),
      execTrace: SimulationTransactionExecTrace.fromEncodingData(
        data.get('exec-trace') ?? new Map()
      ),
    });
  }
}

/** A line of a program's disassembly. */
export class DisassemblyLine implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        {
          key: 'pc',
          valueSchema: new OptionalSchema(new Uint64Schema()),
          omitEmpty: true,
        },
        { key: 'text', valueSchema: new StringSchema(), omitEmpty: false }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The program counter of the line's opcode, as a trace's `pc`; undefined
   * for a line without one, such as `#pragma version` or a label (pc 0 is
   * the version byte, never an opcode).
   */
  public pc?: number;

  /** The line. */
  public text: string;

  /**
   * Creates a new `DisassemblyLine` object.
   * @param pc - The program counter of the line's opcode.
   * @param text - The line.
   */
  constructor({ pc, text }: { pc?: number | bigint; text: string }) {
    this.pc = typeof pc === 'undefined' ? undefined : ensureSafeInteger(pc);
    this.text = text;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return DisassemblyLine.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['pc', this.pc],
      ['text', this.text],
    ]);
  }

  static fromEncodingData(data: unknown): DisassemblyLine {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded DisassemblyLine: ${data}`);
    }
    return new DisassemblyLine({
      pc: data.get('pc'),
      text: data.get('text') ?? '',
    });
  }
}

/**
 * The disassembly of a program a trace ran (`include(['trace'])`), line by
 * line.
 */
export class ProgramDisassembly implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'hash', valueSchema: new ByteArraySchema(), omitEmpty: false },
        {
          key: 'lines',
          valueSchema: new ArraySchema(DisassemblyLine.encodingSchema),
          omitEmpty: false,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /**
   * The program's hash, as the traces' `approvalProgramHash`,
   * `clearStateProgramHash` and `logicSigHash` give it.
   */
  public hash: Uint8Array;

  /** The lines of the disassembly. */
  public lines: DisassemblyLine[];

  /**
   * Creates a new `ProgramDisassembly` object.
   * @param hash - The program's hash (bytes, or base64).
   * @param lines - The lines of the disassembly.
   */
  constructor({
    hash,
    lines,
  }: {
    hash: string | Uint8Array;
    lines: DisassemblyLine[];
  }) {
    this.hash = typeof hash === 'string' ? base64ToBytes(hash) : hash;
    this.lines = lines;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return ProgramDisassembly.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['hash', this.hash],
      ['lines', this.lines.map((l) => l.toEncodingData())],
    ]);
  }

  static fromEncodingData(data: unknown): ProgramDisassembly {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded ProgramDisassembly: ${data}`);
    }
    return new ProgramDisassembly({
      hash: data.get('hash'),
      lines: (data.get('lines') ?? []).map((l: unknown) =>
        DisassemblyLine.fromEncodingData(l)
      ),
    });
  }
}

/**
 * The app state changes of each transaction of a round
 * (`GET /v2/deltas/{round}/txn/state-changes`), and, when asked for with
 * `include()` or `full()`, everything else each group changed, and with
 * `include()` or `trace()`, the opcode budget of each program run, the app
 * state each transaction read, and the execution traces of a group.
 */
export class TxnStateChangesResponse implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'round', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'txns',
          valueSchema: new ArraySchema(TxnStateChanges.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'groups',
          valueSchema: new PresentOptionalSchema(
            new ArraySchema(GroupStateChanges.encodingSchema)
          ),
          omitEmpty: true,
        },
        {
          key: 'fee-sink',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
        {
          key: 'budget',
          valueSchema: new PresentOptionalSchema(
            new ArraySchema(ProgramBudget.encodingSchema)
          ),
          omitEmpty: true,
        },
        {
          key: 'reads',
          valueSchema: new PresentOptionalSchema(
            new ArraySchema(TxnStateReads.encodingSchema)
          ),
          omitEmpty: true,
        },
        {
          key: 'traces',
          valueSchema: new PresentOptionalSchema(
            new ArraySchema(TxnExecTrace.encodingSchema)
          ),
          omitEmpty: true,
        },
        {
          key: 'programs',
          valueSchema: new PresentOptionalSchema(
            new ArraySchema(ProgramDisassembly.encodingSchema)
          ),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** The round. */
  public round: bigint;

  /**
   * The transactions that changed app state, top-level and inner, in
   * execution order (a parent before its inner transactions). A transaction
   * that changed nothing, or nothing the filters kept, is left out.
   */
  public txns: TxnStateChanges[];

  /**
   * With `include()` or `full()`: one entry per top-level group of the round
   * (a transaction not in a group is a group of one), in block order, with
   * what it changed other than app state. `txids()` and `txid()` narrow it
   * to the groups of those transactions; `app()` does not narrow it.
   * Undefined without `include()`.
   */
  public groups?: GroupStateChanges[];

  /**
   * With `include()` or `full()`: the round's fee sink, which is in the
   * `accounts` of every group that paid fees
   * (`withoutFeeSink(group, response.feeSink)` drops it).
   */
  public feeSink?: Address;

  /**
   * With `include(['budget'])`: each program run of the transactions asked
   * for (all of the round's without `txid()` or `txids()`), top-level and
   * inner, in the order they began; a group's logic sigs first, as the node
   * checks them before it evaluates the group. `budgetOf` finds a
   * transaction's. Undefined without `budget`.
   */
  public budget?: ProgramBudget[];

  /**
   * With `include(['reads'])`: each transaction asked for that read app
   * state, top-level and inner, in the order it first read. Undefined
   * without `reads`.
   */
  public reads?: TxnStateReads[];

  /**
   * With `trace()`: the execution trace of each top-level transaction of the
   * group of the one transaction asked for, in group order. Undefined
   * without `trace`.
   */
  public traces?: TxnExecTrace[];

  /**
   * With `trace()`: the disassembly of each program the traces ran
   * (`programLine` maps a trace's `pc` to its line). Undefined without
   * `trace`.
   */
  public programs?: ProgramDisassembly[];

  /**
   * Creates a new `TxnStateChangesResponse` object.
   * @param round - The round.
   * @param txns - The transactions that changed app state, in execution order.
   * @param groups - What each group changed other than app state.
   * @param feeSink - The round's fee sink.
   * @param budget - The opcode budget of each program run.
   * @param reads - The app state each transaction read.
   * @param traces - The execution traces of a group.
   * @param programs - The disassembly of the programs the traces ran.
   */
  constructor({
    round,
    txns,
    groups,
    feeSink,
    budget,
    reads,
    traces,
    programs,
  }: {
    round: number | bigint;
    txns: TxnStateChanges[];
    groups?: GroupStateChanges[];
    feeSink?: Address | string;
    budget?: ProgramBudget[];
    reads?: TxnStateReads[];
    traces?: TxnExecTrace[];
    programs?: ProgramDisassembly[];
  }) {
    this.round = ensureBigInt(round);
    this.txns = txns;
    this.groups = groups;
    this.feeSink =
      typeof feeSink === 'string' ? Address.fromString(feeSink) : feeSink;
    this.budget = budget;
    this.reads = reads;
    this.traces = traces;
    this.programs = programs;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return TxnStateChangesResponse.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['round', this.round],
      ['txns', this.txns.map((t) => t.toEncodingData())],
      ['groups', this.groups?.map((g) => g.toEncodingData())],
      ['fee-sink', this.feeSink?.toString()],
      ['budget', this.budget?.map((b) => b.toEncodingData())],
      ['reads', this.reads?.map((r) => r.toEncodingData())],
      ['traces', this.traces?.map((t) => t.toEncodingData())],
      ['programs', this.programs?.map((p) => p.toEncodingData())],
    ]);
  }

  static fromEncodingData(data: unknown): TxnStateChangesResponse {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded TxnStateChangesResponse: ${data}`);
    }
    const groups = data.get('groups');
    const list = <T>(key: string, decode: (d: unknown) => T) =>
      optionalModel(data.get(key), (l) => (l as unknown[]).map(decode));
    return new TxnStateChangesResponse({
      round: data.get('round'),
      txns: (data.get('txns') ?? []).map((t: unknown) =>
        TxnStateChanges.fromEncodingData(t)
      ),
      groups: optionalModel(groups, (gs) =>
        (gs as unknown[]).map((g) => GroupStateChanges.fromEncodingData(g))
      ),
      feeSink: data.get('fee-sink'),
      budget: list('budget', (b) => ProgramBudget.fromEncodingData(b)),
      reads: list('reads', (r) => TxnStateReads.fromEncodingData(r)),
      traces: list('traces', (t) => TxnExecTrace.fromEncodingData(t)),
      programs: list('programs', (p) => ProgramDisassembly.fromEncodingData(p)),
    });
  }
}
