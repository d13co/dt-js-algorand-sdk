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
import {
  Account,
  Application,
  ApplicationLocalState,
  Asset,
  AssetHolding,
} from '../models/types.js';

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
