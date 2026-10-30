# dt-js-algorand-sdk

[![npm version](https://badge.fury.io/js/dtalgosdk.svg)](https://www.npmjs.com/package/dtalgosdk)

## dtalgosdk: algosdk for time-travel algod

This is `dtalgosdk`, a fork of [algosdk](https://www.npmjs.com/package/algosdk) v3.9.0 for a time-travel algod: [dt-algorand](https://github.com/d13co/dt-algorand/tree/dtalgorand), the go-algorand fork run with `EnableTimeTravel: true`, which keeps the state of every round since genesis. It is a drop-in replacement: everything in algosdk is unchanged, and the additions are new exports. The main changes:

- **`DTAlgodClient`**, an `AlgodClient` subclass. `DTAlgodClient.from(algod)` wraps an existing client, such as algokit-utils' `algorand.client.algod`.
- **Reads at past rounds**: `.round(R)` on account, asset, application, box and supply reads.
- **History**: `...Versions` methods list the rounds at which an account, asset, application, box, or any of an app's boxes changed, with paging and values; `rounds([...])` gives each object as of a set of rounds, `include('keys')` the state keys each version changed, and `key()` / `prefix()` the history of one state key or box map.
- **Asset holders**: `getAssetHolders()` lists every holder of an asset at a round.
- **Simulate** with several groups per request (in sequence or with `parallelGroups()`), at several rounds per request (`rounds()`), with the validity window skipped or moved to each round (`skipValidityWindow()`, `rewriteValidityWindow()`), and under a later consensus protocol (`protocol()`).
- **Query**: `query()` runs read-only TEAL calls (one program or deployed app, many calls) at several rounds per request through the fork's `POST /v2/query`, returning each call's logs, cost and error per round, without transactions, signatures or fees.
- **Helpers**: `DTSimulateRequest.fromTransactions()` for unsigned transactions, `packSimulateRounds()` to split rounds into requests, `groupResults()` for each group's outcome or a typed `SimulateGroupError`, `simulateLimits()` for the node's limits (including its query limits), `isQueryResponseTooLarge()` to split a query whose results are over the node's limit, `isNodeBusy()` / `retryAfterSeconds()` / `isTimeLimitExceeded()` / `isHistoryUnavailable()` for the node's busy, time limit and history errors, and `doWithHeaders()` / `effortOf()` for response headers.
- **Feature detection**: `simulateLimits()`, `supportsDT()` and `supportsAssetHolders()` say which optional features the node has on (time travel, the holders index, query, simulate rounds), and a `DTUnsupportedError` is thrown when a request needs one that is off, so code can fall back.
- **Fix**: ABI dynamic arrays and tuples decode `Uint8Array` subarrays correctly.
- **Faster decoding**: time-travel pages are parsed with `JSON.parse` when no integer needs a bigint, addresses already checked skip their checksum, and base64 is faster in browsers.

See **[DTALGOSDK.md](https://github.com/d13co/dt-js-algorand-sdk/blob/dtalgorand/DTALGOSDK.md)** for the detailed differences, API reference and examples. Source and issues: [d13co/dt-js-algorand-sdk](https://github.com/d13co/dt-js-algorand-sdk) (branch `dtalgorand`).

### Installing dtalgosdk in place of algosdk

Install it under the name `algosdk` with a package-manager override, so that your code and every dependency that uses algosdk (algokit-utils, use-wallet, ...) load the same single copy. Imports stay `from 'algosdk'`.

npm (`package.json`):

```json
{
  "dependencies": {
    "algosdk": "npm:dtalgosdk@3.9.0-dt.4.0.0.1"
  },
  "overrides": {
    "algosdk": "$algosdk"
  }
}
```

pnpm 10 and later (`pnpm-workspace.yaml`; pnpm 11 and later read overrides only from here):

```yaml
overrides:
  algosdk: npm:dtalgosdk@3.9.0-dt.4.0.0.1
```

pnpm 9 (`package.json`; it warns about an unmet `algosdk` peer dependency, which is harmless):

```json
{
  "pnpm": {
    "overrides": {
      "algosdk": "npm:dtalgosdk@3.9.0-dt.4.0.0.1"
    }
  }
}
```

Yarn and Bun (`package.json`):

```json
{
  "dependencies": {
    "algosdk": "npm:dtalgosdk@3.9.0-dt.4.0.0.1"
  },
  "resolutions": {
    "algosdk": "npm:dtalgosdk@3.9.0-dt.4.0.0.1"
  }
}
```

Yarn 4 refuses versions published less than a day ago (`npmMinimalAgeGate`). To install a new dtalgosdk release right away, add `npmPreapprovedPackages: ["dtalgosdk"]` to `.yarnrc.yml`.

`npm ls algosdk` or `pnpm why algosdk` (`yarn why dtalgosdk` on Yarn) should then list only `dtalgosdk@3.9.0-dt.4.0.0.1`. Pin the exact version: dtalgosdk versions are prereleases, and ranges such as `^3.9.0` do not match them. A version reads `<algosdk version>-dt.<dt-algorand release>.<SDK release>`: `3.9.0-dt.4.0.0.1` is built on algosdk 3.9.0, covers the API of dt-algorand dt4 (`v5.0.5-dt4`), and is SDK release 0.0.1 for that pair.

### Quick start

```typescript
import algosdk from 'algosdk';

const algod = algosdk.DTAlgodClient.from(algorand.client.algod);

// A box as it was at round 45,000,000.
const box = await algod
  .getApplicationBoxByName(appId, boxName)
  .round(45_000_000)
  .do();

// The last 10 rounds at which any of the app's boxes changed.
const { versions } = await algod
  .getApplicationBoxesVersions(appId)
  .order('desc')
  .limit(10)
  .do();
```

The rest of this README is upstream algosdk's, with the installation steps changed to install dtalgosdk.

---

AlgoSDK is the official JavaScript library for communicating with the Algorand network. It's designed for modern browsers and Node.js.

## New Major Version 3

Existing codebases using v2 of this library will be incompatible with v3. The v3 release introduces breaking changes to the API, and a migration guide is available [here](https://github.com/algorand/js-algorand-sdk/blob/main/v2_TO_v3_MIGRATION_GUIDE.md).

## Installation

### [Node.js](https://nodejs.org/en/download/)

```
$ npm install algosdk@npm:dtalgosdk@3.9.0-dt.4.0.0.1
```

This installs dtalgosdk under the name `algosdk`. If other dependencies use algosdk, also add the override from [Installing dtalgosdk in place of algosdk](#installing-dtalgosdk-in-place-of-algosdk), so that there is only one copy.

> This package provides TypeScript types, but you will need [TypeScript](https://www.typescriptlang.org/) version 4.2 or higher to use them properly.

### Browser

Include a minified browser bundle directly in your HTML like so. It defines the global `algosdk`, which includes `DTAlgodClient`:

```html
<script
  src="https://unpkg.com/dtalgosdk@3.9.0-dt.4.0.0.1/dist/browser/algosdk.min.js"
  integrity="sha384-EbIT4hUDb3D+0PfV1xpcQR2E3Ry+hzhyE/BPVsy8bhDwQlaaRgwR1bxmIUn0H2Xc"
  crossorigin="anonymous"
></script>
```

or

```html
<script
  src="https://cdn.jsdelivr.net/npm/dtalgosdk@3.9.0-dt.4.0.0.1/dist/browser/algosdk.min.js"
  integrity="sha384-EbIT4hUDb3D+0PfV1xpcQR2E3Ry+hzhyE/BPVsy8bhDwQlaaRgwR1bxmIUn0H2Xc"
  crossorigin="anonymous"
></script>
```

Information about hosting the package for yourself, finding the browser bundles of previous versions, and computing the SRI hash is [available here](FAQ.md).

## Quick Start

```javascript
const token = 'Your algod API token';
const server = 'http://127.0.0.1';
const port = 8080;
const client = new algosdk.Algodv2(token, server, port);

(async () => {
  console.log(await client.status().do());
})().catch((e) => {
  console.log(e);
});
```

## Documentation

Documentation for this SDK is available here: https://algorand.github.io/js-algorand-sdk/. Additional resources are available on https://developer.algorand.org.

## Examples

Running examples requires access to a running node. Follow the instructions in Algorand's [developer resources](https://developer.algorand.org/docs/run-a-node/setup/install/) to install a node on your computer.

**As portions of the codebase are written in TypeScript, example files cannot be run directly using `node`**. Please refer to the instructions described in the [examples/README.md](examples/README.md) file for more information regarding running the examples.

## SDK Development

### Building

To build a new version of the library, run:

```bash
npm run build
```

### Generating Documentation

To generate the documentation website, run:

```bash
npm run docs
```

The static website will be located in the `docs/` directory.

### Testing

We have two test suites: mocha tests in this repo, and the Algorand SDK test suite from https://github.com/algorand/algorand-sdk-testing.

#### Node.js

To run the mocha tests in Node.js, run:

```bash
npm test
```

To run the SDK test suite in Node.js, run:

```bash
make docker-test
```

#### Browsers

The test suites can also run in browsers. To do so, set the environment variable `TEST_BROWSER` to one of our supported browsers. Currently we support testing in `chrome` and `firefox`. When `TEST_BROWSER` is set, the mocha and SDK test suites will run in that browser.

For example, to run mocha tests in Chrome:

```bash
TEST_BROWSER=chrome npm test
```

And to run SDK tests in Firefox:

```bash
TEST_BROWSER=firefox make docker-test
```

### Code Style

This project enforces a modified version of the [Airbnb code style](https://github.com/airbnb/javascript).

We've setup linters and formatters to help catch errors and improve the development experience:

- [Prettier](https://prettier.io/) – ensures that code is formatted in a readable way.
- [ESLint](https://eslint.org/) — checks code for antipatterns as well as formatting.

> If using the Visual Studio Code editor with the [recommended extensions](.vscode/extensions.json), ESLint errors should be highlighted in red and the Prettier extension should format code on every save.

#### Precommit Hook

The linters and formatters listed above should run automatically on each commit to catch errors early and save CI running time.

## License

js-algorand-sdk is licensed under an MIT license. See the [LICENSE](https://github.com/algorand/js-algorand-sdk/blob/master/LICENSE) file for details.
