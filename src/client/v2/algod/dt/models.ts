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
import { Encodable, Schema } from '../../../../encoding/encoding.js';
import {
  NamedMapSchema,
  ArraySchema,
  Uint64Schema,
  StringSchema,
  BooleanSchema,
  ByteArraySchema,
  OptionalSchema,
  NamedMapEntry,
} from '../../../../encoding/schema/index.js';
import { base64ToBytes } from '../../../../encoding/binarydata.js';
import {
  Account,
  Application,
  ApplicationLocalState,
  Asset,
  AssetHolding,
  SimulateRequest,
  SimulateInitialStates,
  SimulateRequestTransactionGroup,
  SimulateResponse,
  SimulateTransactionGroupResult,
  SimulateTraceConfig,
  SimulationEvalOverrides,
} from '../models/types.js';
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
   * With `include=values`, the new box value. Absent on deletions.
   */
  public value?: Uint8Array;

  /**
   * Creates a new `BoxChange` object.
   * @param name - The box name.
   * @param deleted - Whether the change is the deletion of the box.
   * @param value - With `include=values`, the new box value. Absent on deletions.
   */
  constructor({
    name,
    deleted,
    value,
  }: {
    name: string | Uint8Array;
    deleted: boolean;
    value?: string | Uint8Array;
  }) {
    this.name = typeof name === 'string' ? base64ToBytes(name) : name;
    this.deleted = deleted;
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
   * The round of the version.
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
   * descending page resumed from `next`, the round in the token.
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
          key: 'asset',
          valueSchema: new OptionalSchema(Asset.encodingSchema),
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
   * Whether the version is the deletion of the asset.
   */
  public deleted: boolean;

  /**
   * With `include=values`, the new asset parameters. Absent on deletions.
   */
  public asset?: Asset;

  /**
   * Creates a new `AssetVersion` object.
   * @param round - The round of the version.
   * @param timestamp - The timestamp of the version's block, in seconds since the epoch.
   * @param deleted - Whether the version is the deletion of the asset.
   * @param asset - With `include=values`, the new asset parameters. Absent on deletions.
   */
  constructor({
    round,
    timestamp,
    deleted,
    asset,
  }: {
    round: number | bigint;
    timestamp: number | bigint;
    deleted: boolean;
    asset?: Asset;
  }) {
    this.round = ensureBigInt(round);
    this.timestamp = ensureSafeInteger(timestamp);
    this.deleted = deleted;
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
   * descending page resumed from `next`, the round in the token.
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
          key: 'application',
          valueSchema: new OptionalSchema(Application.encodingSchema),
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
   * Whether the version is the deletion of the application.
   */
  public deleted: boolean;

  /**
   * With `include=values`, the new application parameters. Absent on deletions.
   */
  public application?: Application;

  /**
   * Creates a new `ApplicationVersion` object.
   * @param round - The round of the version.
   * @param timestamp - The timestamp of the version's block, in seconds since the epoch.
   * @param deleted - Whether the version is the deletion of the application.
   * @param application - With `include=values`, the new application parameters. Absent on deletions.
   */
  constructor({
    round,
    timestamp,
    deleted,
    application,
  }: {
    round: number | bigint;
    timestamp: number | bigint;
    deleted: boolean;
    application?: Application;
  }) {
    this.round = ensureBigInt(round);
    this.timestamp = ensureSafeInteger(timestamp);
    this.deleted = deleted;
    this.application = application;
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
      [
        'application',
        typeof this.application !== 'undefined'
          ? this.application.toEncodingData()
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
      application:
        typeof data.get('application') !== 'undefined'
          ? Application.fromEncodingData(data.get('application'))
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
   * descending page resumed from `next`, the round in the token.
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
   * The round of the version.
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
   * With `include=values`, the account as of the version's round, without its
   * assets and applications, as `accountInformation(address).exclude('all')`
   * returns it at that round.
   */
  public account?: Account;

  /**
   * Creates a new `AccountBaseVersion` object.
   * @param deleted - Whether the account was closed.
   * @param account - With `include=values`, the account as of the version's round, without its
   */
  constructor({ deleted, account }: { deleted: boolean; account?: Account }) {
    this.deleted = deleted;
    this.account = account;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return AccountBaseVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['deleted', this.deleted],
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
   * With `include=values`, the new holding.
   */
  public assetHolding?: AssetHolding;

  /**
   * Creates a new `AssetHoldingVersion` object.
   * @param assetId - The asset.
   * @param deleted - Whether the version is the deletion of the holding (opt out).
   * @param assetHolding - With `include=values`, the new holding.
   */
  constructor({
    assetId,
    deleted,
    assetHolding,
  }: {
    assetId: number | bigint;
    deleted: boolean;
    assetHolding?: AssetHolding;
  }) {
    this.assetId = ensureBigInt(assetId);
    this.deleted = deleted;
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
          key: 'app-local-state',
          valueSchema: new OptionalSchema(ApplicationLocalState.encodingSchema),
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
   * With `include=values`, the new local state.
   */
  public appLocalState?: ApplicationLocalState;

  /**
   * Creates a new `ApplicationLocalStateVersion` object.
   * @param appId - The application.
   * @param deleted - Whether the version is the deletion of the local state (close out or
   * @param appLocalState - With `include=values`, the new local state.
   */
  constructor({
    appId,
    deleted,
    appLocalState,
  }: {
    appId: number | bigint;
    deleted: boolean;
    appLocalState?: ApplicationLocalState;
  }) {
    this.appId = ensureBigInt(appId);
    this.deleted = deleted;
    this.appLocalState = appLocalState;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return ApplicationLocalStateVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['app-id', this.appId],
      ['deleted', this.deleted],
      [
        'app-local-state',
        typeof this.appLocalState !== 'undefined'
          ? this.appLocalState.toEncodingData()
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
      appLocalState:
        typeof data.get('app-local-state') !== 'undefined'
          ? ApplicationLocalState.fromEncodingData(data.get('app-local-state'))
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
   * With `include=values`, the new asset parameters.
   */
  public asset?: Asset;

  /**
   * Creates a new `CreatedAssetVersion` object.
   * @param assetId - The asset.
   * @param deleted - Whether the version is the deletion of the asset.
   * @param asset - With `include=values`, the new asset parameters.
   */
  constructor({
    assetId,
    deleted,
    asset,
  }: {
    assetId: number | bigint;
    deleted: boolean;
    asset?: Asset;
  }) {
    this.assetId = ensureBigInt(assetId);
    this.deleted = deleted;
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
          key: 'application',
          valueSchema: new OptionalSchema(Application.encodingSchema),
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
   * With `include=values`, the new application parameters.
   */
  public application?: Application;

  /**
   * Creates a new `CreatedApplicationVersion` object.
   * @param appId - The application.
   * @param deleted - Whether the version is the deletion of the application.
   * @param application - With `include=values`, the new application parameters.
   */
  constructor({
    appId,
    deleted,
    application,
  }: {
    appId: number | bigint;
    deleted: boolean;
    application?: Application;
  }) {
    this.appId = ensureBigInt(appId);
    this.deleted = deleted;
    this.application = application;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return CreatedApplicationVersion.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['app-id', this.appId],
      ['deleted', this.deleted],
      [
        'application',
        typeof this.application !== 'undefined'
          ? this.application.toEncodingData()
          : undefined,
      ],
    ]);
  }

  static fromEncodingData(data: unknown): CreatedApplicationVersion {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded CreatedApplicationVersion: ${data}`);
    }
    return new CreatedApplicationVersion({
      appId: data.get('app-id'),
      deleted: data.get('deleted'),
      application:
        typeof data.get('application') !== 'undefined'
          ? Application.fromEncodingData(data.get('application'))
          : undefined,
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
   * descending page resumed from `next`, the round in the token.
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
 * The entries of a generated model's schema, to build a fork model's schema
 * from.
 */
function entriesOf(schema: Schema): NamedMapEntry[] {
  return (schema as NamedMapSchema).getEntries();
}

/**
 * A transaction that read data a {@link SimulateProtocolNote} is about.
 */
export class SimulateProtocolNoteHit implements Encodable {
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

  /** The 0-based index of the transaction group in the request. */
  public group: number;

  /**
   * The path of the transaction in its group, as in `failedAt`. A logic
   * signature's hit has the path of its top-level transaction.
   */
  public path: number[];

  /**
   * Creates a new `SimulateProtocolNoteHit` object.
   * @param group - The 0-based index of the transaction group in the request.
   * @param path - The path of the transaction in its group, as in `failedAt`.
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
    return SimulateProtocolNoteHit.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['group', this.group],
      ['path', this.path],
    ]);
  }

  static fromEncodingData(data: unknown): SimulateProtocolNoteHit {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded SimulateProtocolNoteHit: ${data}`);
    }
    return new SimulateProtocolNoteHit({
      group: data.get('group') ?? 0,
      path: data.get('path') ?? [],
    });
  }
}

/**
 * The codes of {@link SimulateProtocolNote}, as of this client. A newer node
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
export type SimulateProtocolNoteCode =
  | 'semantics-changed'
  | 'no-heartbeat-challenges'
  | 'no-load-history'
  | 'block-incentive-fields'
  | 'block-hash-fields'
  | 'online-stake-includes-expired'
  | 'account-incentive-fields'
  | 'app-version-starts-at-upgrade';

/**
 * A note about simulating under a later protocol: where the simulation
 * differs from what the chain recorded, or read data the chain never produced.
 */
export class SimulateProtocolNote implements Encodable {
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
            new ArraySchema(SimulateProtocolNoteHit.encodingSchema)
          ),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** What the note is about: a {@link SimulateProtocolNoteCode}. */
  public code: SimulateProtocolNoteCode | (string & {});

  /** The note, for people. */
  public message: string;

  /**
   * The transactions that read the data the note is about, at most 16.
   * Undefined for notes about the protocol change as a whole.
   */
  public hits?: SimulateProtocolNoteHit[];

  /**
   * Creates a new `SimulateProtocolNote` object.
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
    hits?: SimulateProtocolNoteHit[];
  }) {
    this.code = code;
    this.message = message;
    this.hits = hits;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return SimulateProtocolNote.encodingSchema;
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

  static fromEncodingData(data: unknown): SimulateProtocolNote {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded SimulateProtocolNote: ${data}`);
    }
    return new SimulateProtocolNote({
      code: data.get('code') ?? '',
      message: data.get('message') ?? '',
      hits:
        typeof data.get('hits') !== 'undefined'
          ? data
              .get('hits')
              .map((v: unknown) => SimulateProtocolNoteHit.fromEncodingData(v))
          : undefined,
    });
  }
}

/**
 * How a simulate request's `protocol` applied to the simulated round.
 */
export class SimulateProtocolOverride implements Encodable {
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
            new ArraySchema(SimulateProtocolNote.encodingSchema)
          ),
          omitEmpty: true,
        }
      );
    }
    return this.encodingSchemaValue;
  }

  /** The protocol the round after the simulated one really ran. */
  public from: string;

  /** The requested protocol, with aliases (`v42`, `latest`) resolved. */
  public to: string;

  /** False when `from` is already `to`: the round was simulated as it is. */
  public applied: boolean;

  /**
   * Where the simulation under `to` differs from what the chain recorded, or
   * read data the chain never produced. Only set when `applied`.
   */
  public notes?: SimulateProtocolNote[];

  /**
   * Creates a new `SimulateProtocolOverride` object.
   * @param from - The protocol the round after the simulated one really ran.
   * @param to - The requested protocol, with aliases resolved.
   * @param applied - False when `from` is already `to`.
   * @param notes - Where the simulation differs from the chain.
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
    notes?: SimulateProtocolNote[];
  }) {
    this.from = from;
    this.to = to;
    this.applied = applied;
    this.notes = notes;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return SimulateProtocolOverride.encodingSchema;
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

  static fromEncodingData(data: unknown): SimulateProtocolOverride {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded SimulateProtocolOverride: ${data}`);
    }
    return new SimulateProtocolOverride({
      from: data.get('from') ?? '',
      to: data.get('to') ?? '',
      applied: data.get('applied') ?? false,
      notes:
        typeof data.get('notes') !== 'undefined'
          ? data
              .get('notes')
              .map((v: unknown) => SimulateProtocolNote.fromEncodingData(v))
          : undefined,
    });
  }
}

/**
 * A {@link SimulateRequest} with the fork's simulate fields.
 *
 * `txnGroups` may hold several groups, up to the node's `MaxAPISimulateGroups`
 * (default 16). By default they run in order as consecutive groups of one
 * simulated block: each group sees the effects of the groups before it, a
 * transaction or lease used by an earlier group is a duplicate, and the groups
 * share the block's byte limit. A group that fails is rolled back and the
 * later groups still run, except after a failed post-evaluation check
 * (placeholder PQ signatures with `fixSigners`) or a corrupted evaluator:
 * every later group is then reported as not simulated. With `parallelGroups`,
 * every group is simulated alone against the state at the start round.
 */
export class DTSimulateRequest extends SimulateRequest {
  private static dtEncodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.dtEncodingSchemaValue) {
      this.dtEncodingSchemaValue = new NamedMapSchema([
        ...entriesOf(SimulateRequest.encodingSchema),
        {
          key: 'parallel-groups',
          valueSchema: new OptionalSchema(new BooleanSchema()),
          omitEmpty: true,
        },
        {
          key: 'rounds',
          valueSchema: new OptionalSchema(new ArraySchema(new Uint64Schema())),
          omitEmpty: true,
        },
        {
          key: 'skip-validity-window',
          valueSchema: new OptionalSchema(new BooleanSchema()),
          omitEmpty: true,
        },
        {
          key: 'rewrite-validity-window',
          valueSchema: new OptionalSchema(new BooleanSchema()),
          omitEmpty: true,
        },
        {
          key: 'protocol',
          valueSchema: new OptionalSchema(new StringSchema()),
          omitEmpty: true,
        },
      ]);
    }
    return this.dtEncodingSchemaValue;
  }

  /**
   * If true, every transaction group is simulated alone against the state at
   * the start round, concurrently, instead of as consecutive groups of one
   * block. Groups then do not see each other's effects, duplicate transactions
   * and leases are not detected across groups, and several groups may create
   * the same app or asset ID.
   */
  public parallelGroups?: boolean;

  /**
   * If not empty, the request is simulated once per listed round, each entry
   * meaning what `round` means (0 is the latest round), and the results are in
   * the response's `roundResults`, one per entry in this order. Cannot be
   * combined with a non-zero `round`. The node's `MaxAPISimulateRounds`
   * (default 16) limits how many entries, duplicates included.
   */
  public rounds?: bigint[];

  /**
   * If true, the transactions are evaluated as sent at every round, even
   * outside their `firstValid`..`lastValid` window: the round-range check and
   * the check for a transaction ID confirmed earlier are skipped, so `rounds`
   * can be more than `MaxTxnLife` (1000) apart. Leases, duplicates in the
   * block, the genesis ID and hash, well-formedness and fees are still
   * checked. Programs see the original window, so `block`, the
   * `FirstValidTime` field and inner transactions stay tied to it, and reading a
   * block after the start round fails. Only with `rounds`, and not with
   * `rewriteValidityWindow`.
   */
  public skipValidityWindow?: boolean;

  /**
   * If true, at every round each top-level transaction's window is moved to
   * the simulated block, keeping its width, and valid group IDs are
   * recomputed, so `rounds` can be more than `MaxTxnLife` (1000) apart.
   * Transaction IDs change, so the signatures over every changed transaction
   * (sig, msig, PQ signature bytes) are dropped: requires
   * `allowEmptySignatures`. Logic signatures are kept. The results echo the
   * rewritten transactions, so do not match them by transaction ID, and give
   * transactions that differ only by their window distinct notes, or the
   * later one is a duplicate. Only with `rounds`, and not with
   * `skipValidityWindow`.
   */
  public rewriteValidityWindow?: boolean;

  /**
   * If set, the simulated round runs this consensus protocol, as if an
   * upgrade to it took effect right after the start round: its programs,
   * limits, fees and other parameters apply, to programs deployed earlier
   * too. A consensus version string, `v24` to `v42` for a mainline one,
   * `latest` (the protocol of the block after the node's latest one) or
   * `future` (vFuture, only with `EnableDeveloperAPI`). It must be a later
   * protocol of the chain than the one the round really ran. The response's
   * `protocolOverride` (each round result's, with `rounds`) says how it
   * applied and where the simulation differs from what the chain recorded.
   * An unknown name, or `future` without the developer API, fails the whole
   * request; a protocol that is not a later one of the chain is a 400, or
   * that round's `error` with `rounds`; the protocol the round really ran
   * is simulated as it is, with `applied` false.
   */
  public protocol?: string;

  /**
   * Creates a new `DTSimulateRequest` object.
   * @param parallelGroups - If true, every transaction group is simulated alone
   * against the state at the start round, concurrently.
   * @param rounds - If not empty, simulate the request once per listed round.
   * @param skipValidityWindow - If true, evaluate the transactions as sent at
   * every round, outside their validity window. Only with `rounds`.
   * @param rewriteValidityWindow - If true, move each transaction's validity
   * window to the simulated block, dropping its signature. Only with `rounds`
   * and `allowEmptySignatures`.
   * @param protocol - The consensus protocol to simulate the round under.
   * The other parameters are those of {@link SimulateRequest}.
   */
  constructor({
    parallelGroups,
    rounds,
    skipValidityWindow,
    rewriteValidityWindow,
    protocol,
    ...rest
  }: ConstructorParameters<typeof SimulateRequest>[0] & {
    parallelGroups?: boolean;
    rounds?: (number | bigint)[];
    skipValidityWindow?: boolean;
    rewriteValidityWindow?: boolean;
    protocol?: string;
  }) {
    super(rest);
    this.parallelGroups = parallelGroups;
    this.rounds =
      typeof rounds === 'undefined' ? undefined : rounds.map(ensureUint64);
    this.skipValidityWindow = skipValidityWindow;
    this.rewriteValidityWindow = rewriteValidityWindow;
    this.protocol = protocol;
  }

  /**
   * A copy of a {@link SimulateRequest}, keeping the fork fields if it has
   * them.
   */
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
      ...(request instanceof DTSimulateRequest
        ? {
            parallelGroups: request.parallelGroups,
            rounds: request.rounds,
            skipValidityWindow: request.skipValidityWindow,
            rewriteValidityWindow: request.rewriteValidityWindow,
            protocol: request.protocol,
          }
        : {}),
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
   *   { allowUnnamedResources: true, parallelGroups: true }
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

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return DTSimulateRequest.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    const data = super.toEncodingData();
    data.set('parallel-groups', this.parallelGroups);
    data.set('rounds', this.rounds);
    data.set('skip-validity-window', this.skipValidityWindow);
    data.set('rewrite-validity-window', this.rewriteValidityWindow);
    data.set('protocol', this.protocol);
    return data;
  }

  static fromEncodingData(data: unknown): DTSimulateRequest {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded DTSimulateRequest: ${data}`);
    }
    return new DTSimulateRequest({
      txnGroups: (data.get('txn-groups') ?? []).map((v: unknown) =>
        SimulateRequestTransactionGroup.fromEncodingData(v)
      ),
      allowEmptySignatures: data.get('allow-empty-signatures'),
      allowMoreLogging: data.get('allow-more-logging'),
      allowUnnamedResources: data.get('allow-unnamed-resources'),
      execTraceConfig:
        typeof data.get('exec-trace-config') !== 'undefined'
          ? SimulateTraceConfig.fromEncodingData(data.get('exec-trace-config'))
          : undefined,
      extraOpcodeBudget: data.get('extra-opcode-budget'),
      fixSigners: data.get('fix-signers'),
      round: data.get('round'),
      parallelGroups: data.get('parallel-groups'),
      rounds: data.get('rounds'),
      skipValidityWindow: data.get('skip-validity-window'),
      rewriteValidityWindow: data.get('rewrite-validity-window'),
      protocol: data.get('protocol'),
    });
  }
}

/**
 * A {@link SimulationEvalOverrides} with the fork's simulate fields.
 */
export class DTSimulationEvalOverrides extends SimulationEvalOverrides {
  private static dtEncodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.dtEncodingSchemaValue) {
      this.dtEncodingSchemaValue = new NamedMapSchema([
        ...entriesOf(SimulationEvalOverrides.encodingSchema),
        {
          key: 'parallel-groups',
          valueSchema: new OptionalSchema(new BooleanSchema()),
          omitEmpty: true,
        },
        {
          key: 'skip-validity-window',
          valueSchema: new OptionalSchema(new BooleanSchema()),
          omitEmpty: true,
        },
        {
          key: 'rewrite-validity-window',
          valueSchema: new OptionalSchema(new BooleanSchema()),
          omitEmpty: true,
        },
      ]);
    }
    return this.dtEncodingSchemaValue;
  }

  /**
   * If true, every transaction group was simulated alone against the state at
   * the start round, instead of as consecutive groups of one block.
   */
  public parallelGroups?: boolean;

  /**
   * If true, transactions were evaluated outside their validity window, as
   * sent.
   */
  public skipValidityWindow?: boolean;

  /**
   * If true, transactions' validity windows were moved to the simulated
   * block, and their signatures over the transaction dropped.
   */
  public rewriteValidityWindow?: boolean;

  /**
   * Creates a new `DTSimulationEvalOverrides` object.
   * @param parallelGroups - If true, every transaction group was simulated
   * alone against the state at the start round.
   * @param skipValidityWindow - If true, transactions were evaluated outside
   * their validity window.
   * @param rewriteValidityWindow - If true, transactions' validity windows
   * were moved to the simulated block.
   * The other parameters are those of {@link SimulationEvalOverrides}.
   */
  constructor({
    parallelGroups,
    skipValidityWindow,
    rewriteValidityWindow,
    ...rest
  }: ConstructorParameters<typeof SimulationEvalOverrides>[0] & {
    parallelGroups?: boolean;
    skipValidityWindow?: boolean;
    rewriteValidityWindow?: boolean;
  }) {
    super(rest);
    this.parallelGroups = parallelGroups;
    this.skipValidityWindow = skipValidityWindow;
    this.rewriteValidityWindow = rewriteValidityWindow;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return DTSimulationEvalOverrides.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    const data = super.toEncodingData();
    data.set('parallel-groups', this.parallelGroups);
    data.set('skip-validity-window', this.skipValidityWindow);
    data.set('rewrite-validity-window', this.rewriteValidityWindow);
    return data;
  }

  static fromEncodingData(data: unknown): DTSimulationEvalOverrides {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded DTSimulationEvalOverrides: ${data}`);
    }
    return new DTSimulationEvalOverrides({
      allowEmptySignatures: data.get('allow-empty-signatures'),
      allowUnnamedResources: data.get('allow-unnamed-resources'),
      extraOpcodeBudget: data.get('extra-opcode-budget'),
      fixSigners: data.get('fix-signers'),
      maxLogCalls: data.get('max-log-calls'),
      maxLogSize: data.get('max-log-size'),
      parallelGroups: data.get('parallel-groups'),
      skipValidityWindow: data.get('skip-validity-window'),
      rewriteValidityWindow: data.get('rewrite-validity-window'),
    });
  }
}

/**
 * The simulation result for one entry of a request's `rounds`.
 */
export class SimulateRoundResult implements Encodable {
  private static encodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.encodingSchemaValue) {
      this.encodingSchemaValue = new NamedMapSchema([]);
      (this.encodingSchemaValue as NamedMapSchema).pushEntries(
        { key: 'last-round', valueSchema: new Uint64Schema(), omitEmpty: true },
        {
          key: 'txn-groups',
          valueSchema: new ArraySchema(
            SimulateTransactionGroupResult.encodingSchema
          ),
          omitEmpty: true,
        },
        {
          key: 'initial-states',
          valueSchema: new OptionalSchema(SimulateInitialStates.encodingSchema),
          omitEmpty: true,
        },
        {
          key: 'protocol-override',
          valueSchema: new OptionalSchema(
            SimulateProtocolOverride.encodingSchema
          ),
          omitEmpty: true,
        },
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
   * The round immediately preceding this simulation: the requested round,
   * with 0 resolved to the latest round.
   */
  public lastRound: bigint;

  /**
   * A result object for each transaction group that was simulated at this
   * round. Empty when `error` is set.
   */
  public txnGroups: SimulateTransactionGroupResult[];

  /**
   * Initial states of resources that were accessed during simulation at this
   * round.
   */
  public initialStates?: SimulateInitialStates;

  /**
   * With the request's `protocol`: how it applied at this round. Undefined
   * when `error` is set.
   */
  public protocolOverride?: SimulateProtocolOverride;

  /**
   * If set, the request could not be simulated at this round (the round is not
   * available, or a group is invalid under that round's protocol), and why.
   */
  public error?: string;

  /**
   * Creates a new `SimulateRoundResult` object.
   * @param lastRound - The round immediately preceding this simulation.
   * @param txnGroups - A result object for each transaction group that was
   * simulated at this round.
   * @param initialStates - Initial states of resources that were accessed
   * during simulation at this round.
   * @param protocolOverride - How the request's `protocol` applied at this
   * round.
   * @param error - If set, the request could not be simulated at this round,
   * and why.
   */
  constructor({
    lastRound,
    txnGroups,
    initialStates,
    protocolOverride,
    error,
  }: {
    lastRound: number | bigint;
    txnGroups: SimulateTransactionGroupResult[];
    initialStates?: SimulateInitialStates;
    protocolOverride?: SimulateProtocolOverride;
    error?: string;
  }) {
    this.lastRound = ensureBigInt(lastRound);
    this.txnGroups = txnGroups;
    this.initialStates = initialStates;
    this.protocolOverride = protocolOverride;
    this.error = error;
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return SimulateRoundResult.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    return new Map<string, unknown>([
      ['last-round', this.lastRound],
      ['txn-groups', this.txnGroups.map((v) => v.toEncodingData())],
      [
        'initial-states',
        typeof this.initialStates !== 'undefined'
          ? this.initialStates.toEncodingData()
          : undefined,
      ],
      [
        'protocol-override',
        typeof this.protocolOverride !== 'undefined'
          ? this.protocolOverride.toEncodingData()
          : undefined,
      ],
      ['error', this.error],
    ]);
  }

  static fromEncodingData(data: unknown): SimulateRoundResult {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded SimulateRoundResult: ${data}`);
    }
    return new SimulateRoundResult({
      lastRound: data.get('last-round'),
      txnGroups: (data.get('txn-groups') ?? []).map((v: unknown) =>
        SimulateTransactionGroupResult.fromEncodingData(v)
      ),
      initialStates:
        typeof data.get('initial-states') !== 'undefined'
          ? SimulateInitialStates.fromEncodingData(data.get('initial-states'))
          : undefined,
      protocolOverride:
        typeof data.get('protocol-override') !== 'undefined'
          ? SimulateProtocolOverride.fromEncodingData(
              data.get('protocol-override')
            )
          : undefined,
      error: data.get('error'),
    });
  }
}

/** How the node prefixes the failure message of a group it skipped. */
const NOT_SIMULATED_PREFIX = 'not simulated: ';

/**
 * The outcome of one transaction group at one round of a simulate response,
 * from {@link DTSimulateResponse.groupResult}.
 */
export type SimulateGroupOutcome = {
  /** The index into the response's `roundResults`, or 0 without rounds. */
  roundIndex: number;
  /** The index of the group in the request. */
  groupIndex: number;
  /** The round the simulation ran after (the result's `lastRound`). */
  round: bigint;
} & (
  | { ok: true; result: SimulateTransactionGroupResult }
  | { ok: false; error: SimulateGroupError }
);

/**
 * A {@link SimulateResponse} with the fork's simulate fields.
 *
 * `txnGroups` has one result per requested group, in request order. Each
 * group's failure is in its own `failureMessage` / `failedAt` (0-based).
 * `initialStates` holds the state before the first group, recorded the first
 * time any group accessed it, and leaves out apps created during the
 * simulation.
 *
 * When the request listed `rounds`, the results are in `roundResults`, one per
 * entry in request order, while the top-level `lastRound` is 0 and `txnGroups`
 * is empty. `version`, `evalOverrides` and `execTraceConfig` then come from
 * the first entry that was simulated, or from the request when no round could
 * be simulated.
 */
export class DTSimulateResponse extends SimulateResponse {
  private static dtEncodingSchemaValue: Schema | undefined;

  static get encodingSchema(): Schema {
    if (!this.dtEncodingSchemaValue) {
      this.dtEncodingSchemaValue = new NamedMapSchema(
        entriesOf(SimulateResponse.encodingSchema).map((entry) =>
          entry.key === 'eval-overrides'
            ? {
                ...entry,
                valueSchema: new OptionalSchema(
                  DTSimulationEvalOverrides.encodingSchema
                ),
              }
            : entry
        )
      );
      (this.dtEncodingSchemaValue as NamedMapSchema).pushEntries(
        {
          key: 'protocol-override',
          valueSchema: new OptionalSchema(
            SimulateProtocolOverride.encodingSchema
          ),
          omitEmpty: true,
        },
        {
          key: 'round-results',
          valueSchema: new OptionalSchema(
            new ArraySchema(SimulateRoundResult.encodingSchema)
          ),
          omitEmpty: true,
        }
      );
    }
    return this.dtEncodingSchemaValue;
  }

  /**
   * The parameters and limits overridden during simulation, including
   * `parallelGroups`.
   */
  public evalOverrides?: DTSimulationEvalOverrides;

  /**
   * With the request's `protocol` and no `rounds`: how it applied. With
   * `rounds`, each round result has its own instead.
   */
  public protocolOverride?: SimulateProtocolOverride;

  /**
   * Present when the request listed `rounds`: one result per entry, in the
   * same order.
   */
  public roundResults?: SimulateRoundResult[];

  /**
   * How many transaction groups the request had, set when the response comes
   * from `simulateTransactions().do()`. Not part of the encoding.
   */
  public requestGroupCount?: number;

  /**
   * Creates a new `DTSimulateResponse` object. The parameters are
   * those of {@link SimulateResponse}, with the fork's eval overrides.
   * @param protocolOverride - With `protocol` and no `rounds`, how it applied.
   * @param roundResults - With `rounds`, one result per entry.
   */
  constructor(
    args: Omit<
      ConstructorParameters<typeof SimulateResponse>[0],
      'evalOverrides'
    > & {
      evalOverrides?: DTSimulationEvalOverrides;
      protocolOverride?: SimulateProtocolOverride;
      roundResults?: SimulateRoundResult[];
    }
  ) {
    super(args);
    this.evalOverrides = args.evalOverrides;
    this.protocolOverride = args.protocolOverride;
    this.roundResults = args.roundResults;
  }

  /**
   * The results to read for `roundIndex`: `roundResults[roundIndex]`, or the
   * top level (only index 0) when the request listed no rounds.
   */
  private roundAt(roundIndex: number): {
    round: bigint;
    txnGroups: SimulateTransactionGroupResult[];
    error?: string;
  } {
    const count = this.roundResults ? this.roundResults.length : 1;
    if (
      !Number.isInteger(roundIndex) ||
      roundIndex < 0 ||
      roundIndex >= count
    ) {
      throw new RangeError(
        `Round index ${roundIndex} is out of range: the response has ${this.roundResults ? `${count} round results` : 'no round results, so only index 0'}`
      );
    }
    if (!this.roundResults) {
      return { round: this.lastRound, txnGroups: this.txnGroups };
    }
    const result = this.roundResults[roundIndex];
    return {
      round: result.lastRound,
      txnGroups: result.txnGroups,
      error: result.error,
    };
  }

  /**
   * The outcome of one transaction group at one round: its result, or a
   * {@link SimulateGroupError} saying why there is none (the round could not
   * be simulated, the group failed, it was not simulated, or it is missing).
   *
   * #### Example
   * ```typescript
   * const res = await algodClient
   *   .simulateTransactions(request)
   *   .rounds([45000000, 45000500])
   *   .do();
   * const outcome = res.groupResult(1, 0); // group 1 at round 45000000
   * if (outcome.ok) {
   *   console.log(outcome.result.txnResults[0].txnResult.logs);
   * } else {
   *   console.log(outcome.error.kind, outcome.error.message);
   * }
   * ```
   *
   * @param groupIndex - The index of the group in the request.
   * @param roundIndex - The index into `roundResults`; 0 (the default) when
   * the request listed no rounds.
   * @throws RangeError if `roundIndex` is not an index of the response's
   * rounds, or `groupIndex` is not a non-negative integer.
   */
  groupResult(groupIndex: number, roundIndex = 0): SimulateGroupOutcome {
    if (!Number.isInteger(groupIndex) || groupIndex < 0) {
      throw new RangeError(`Invalid group index ${groupIndex}`);
    }
    const { round, txnGroups, error } = this.roundAt(roundIndex);
    const at = { roundIndex, groupIndex, round };
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

    if (error !== undefined) {
      return fail({ kind: 'round', failureMessage: error });
    }
    const result = txnGroups[groupIndex];
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
   * The outcome of every transaction group at every round, indexed
   * `[roundIndex][groupIndex]`, with a single row when the request listed no
   * rounds. See {@link DTSimulateResponse.groupResult}.
   *
   * @param groupCount - How many groups the request had. Defaults to
   * `requestGroupCount`, which `simulateTransactions().do()` sets. For a
   * response decoded some other way, it defaults to the largest number of
   * group results in a row, which is 0 when no round could be simulated: pass
   * it then to get a row of errors for each such round.
   */
  groupResults(groupCount?: number): SimulateGroupOutcome[][] {
    const rows = this.roundResults ?? [this];
    const width =
      groupCount ??
      this.requestGroupCount ??
      Math.max(0, ...rows.map((r) => r.txnGroups.length));
    return rows.map((_, roundIndex) =>
      Array.from({ length: width }, (__, groupIndex) =>
        this.groupResult(groupIndex, roundIndex)
      )
    );
  }

  // eslint-disable-next-line class-methods-use-this
  getEncodingSchema(): Schema {
    return DTSimulateResponse.encodingSchema;
  }

  toEncodingData(): Map<string, unknown> {
    const data = super.toEncodingData();
    data.set(
      'protocol-override',
      typeof this.protocolOverride !== 'undefined'
        ? this.protocolOverride.toEncodingData()
        : undefined
    );
    data.set(
      'round-results',
      typeof this.roundResults !== 'undefined'
        ? this.roundResults.map((v) => v.toEncodingData())
        : undefined
    );
    return data;
  }

  static fromEncodingData(data: unknown): DTSimulateResponse {
    if (!(data instanceof Map)) {
      throw new Error(`Invalid decoded DTSimulateResponse: ${data}`);
    }
    const base = SimulateResponse.fromEncodingData(data);
    return new DTSimulateResponse({
      lastRound: base.lastRound,
      txnGroups: base.txnGroups,
      version: base.version,
      execTraceConfig: base.execTraceConfig,
      initialStates: base.initialStates,
      evalOverrides:
        typeof data.get('eval-overrides') !== 'undefined'
          ? DTSimulationEvalOverrides.fromEncodingData(
              data.get('eval-overrides')
            )
          : undefined,
      protocolOverride:
        typeof data.get('protocol-override') !== 'undefined'
          ? SimulateProtocolOverride.fromEncodingData(
              data.get('protocol-override')
            )
          : undefined,
      roundResults:
        typeof data.get('round-results') !== 'undefined'
          ? data
              .get('round-results')
              .map((v: unknown) => SimulateRoundResult.fromEncodingData(v))
          : undefined,
    });
  }
}
