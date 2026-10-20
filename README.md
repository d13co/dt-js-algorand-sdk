# js-algorand-sdk

[![npm version](https://badge.fury.io/js/algosdk.svg)](https://www.npmjs.com/package/algosdk)

AlgoSDK is the official JavaScript library for communicating with the Algorand network. It's designed for modern browsers and Node.js.

## New Major Version 3

Existing codebases using v2 of this library will be incompatible with v3. The v3 release introduces breaking changes to the API, and a migration guide is available [here](https://github.com/algorand/js-algorand-sdk/blob/main/v2_TO_v3_MIGRATION_GUIDE.md).

## Installation

### [Node.js](https://nodejs.org/en/download/)

```
$ npm install algosdk
```

> This package provides TypeScript types, but you will need [TypeScript](https://www.typescriptlang.org/) version 4.2 or higher to use them properly.

### Browser

Include a minified browser bundle directly in your HTML like so:

```html
<script
  src="https://unpkg.com/algosdk@v3.9.0/dist/browser/algosdk.min.js"
  integrity="sha384-1ou0X6Dbc+DocuXmvYYLgmOXTRd/u6t8gINEfpvwKs9KrEy6uwGSZuzMZZVWKBxt"
  crossorigin="anonymous"
></script>
```

or

```html
<script
  src="https://cdn.jsdelivr.net/npm/algosdk@v3.9.0/dist/browser/algosdk.min.js"
  integrity="sha384-1ou0X6Dbc+DocuXmvYYLgmOXTRd/u6t8gINEfpvwKs9KrEy6uwGSZuzMZZVWKBxt"
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

## Time-travel fork

This fork adds `DTAlgodClient`, an `AlgodClient` for a time-travel algod: reads at past rounds, the rounds at which objects changed, and simulate with several groups (`parallelGroups()`) at several rounds (`rounds()`), optionally with the transactions' validity windows skipped or moved to each round (`skipValidityWindow()`, `rewriteValidityWindow()`) and under a later consensus protocol (`protocol()`).

### Using it in place of algosdk

Packages such as algokit-utils must load the same copy of algosdk as your code, so replace `algosdk` everywhere with a package-manager override. With pnpm (in `pnpm-workspace.yaml`, or under `pnpm` in `package.json`):

```yaml
overrides:
  # local checkout: run `npm run build` in it first, and after each change
  algosdk: link:/path/to/js-algorand-sdk
  # or a packed build (`npm pack` in the checkout)
  # algosdk: file:./vendor/algosdk-3.8.0-dt.1.tgz
```

`pnpm why algosdk` should then list only the fork.

### Batching read-only simulate calls

```typescript
import algosdk from 'algosdk';

// Reuses the server, token and headers of an existing client.
const algod = algosdk.DTAlgodClient.from(algorand.client.algod);

// Every round of one request must lie in its transactions' validity window.
const { windows, positions } = algosdk.packSimulateRounds(rounds);
const responses = await Promise.all(
  windows.map((w) =>
    algod
      .simulateTransactions(
        algosdk.dtModels.DTSimulateRequest.fromTransactions(
          buildGroups(w.firstValid, w.lastValid), // Transaction[][], up to 16 groups
          { allowUnnamedResources: true, parallelGroups: true }
        )
      )
      .rounds(w.rounds)
      .do()
  )
);
positions.forEach(({ window, roundIndex }, i) => {
  for (const outcome of responses[window].groupResults()[roundIndex]) {
    if (outcome.ok) {
      console.log(rounds[i], outcome.result.txnResults[0].txnResult.logs);
    } else {
      console.log(rounds[i], outcome.error.kind, outcome.error.message);
    }
  }
});
```

### Rounds far apart, under a later protocol

A transaction is valid for at most 1000 rounds, so without help the rounds of one request must lie within 1000 rounds of each other. `rewriteValidityWindow()` moves each transaction's window to every simulated round (it drops their signatures, so it needs `allowEmptySignatures`); `skipValidityWindow()` evaluates them as sent instead. With either, `packSimulateRounds(rounds, { maxSpan: null })` packs by the round limit only. `protocol()` runs the rounds under a later consensus protocol (`v24` to `v42`, `latest`, or a version string), as if an upgrade took effect right after each round, and `protocolOverride` on each round result says how it applied:

```typescript
const res = await algod
  .simulateTransactions(
    algosdk.dtModels.DTSimulateRequest.fromTransactions(groups, {
      allowUnnamedResources: true,
    })
  )
  .rounds([20_000_000, 45_000_000])
  .rewriteValidityWindow()
  .protocol('latest')
  .do();
for (const r of res.roundResults!) {
  const po = r.protocolOverride;
  console.log(r.lastRound, r.error ?? `${po!.from} -> ${po!.to}`);
  for (const note of po?.notes ?? [])
    console.log('  ', note.code, note.message);
}
```

The rewritten transactions get new IDs: match results by group index, not transaction ID, and give transactions that differ only by their window distinct notes.

A node without these features answers with a `DTUnsupportedError`: catch it once and fall back to one group per simulate request. Code that may run on stock algosdk can find the client at runtime and check `DTAlgodClient.features` (for example `'group-results'`) before using it.

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

The test suites can also run in browsers. To do so, set the environment variable `TEST_BROWSER` to
one of our supported browsers. Currently we support testing in `chrome` and `firefox`. When
`TEST_BROWSER` is set, the mocha and SDK test suites will run in that browser.

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
