# dtalgosdk: differences from algosdk

`dtalgosdk` is [algosdk](https://www.npmjs.com/package/algosdk) v3.9.0 with additions for a time-travel algod: a node built from [dt-algorand](https://github.com/d13co/dt-algorand/tree/dtalgorand), the time-travel fork of go-algorand, and run with `EnableTimeTravel: true`, which keeps the state of every round since genesis. Everything in algosdk is unchanged and keeps working against stock algod; the additions are new exports, so code written for algosdk runs on dtalgosdk as is.

"At round R" always means the state at the end of round R, after all of that round's transactions.

- [Summary](#summary)
- [Installing in place of algosdk](#installing-in-place-of-algosdk)
- [New exports](#new-exports)
- [DTAlgodClient](#dtalgodclient)
- [Reads at past rounds](#reads-at-past-rounds)
- [Versions: the rounds at which objects changed](#versions-the-rounds-at-which-objects-changed)
  - [Versions as of rounds](#versions-as-of-rounds)
  - [Changed keys](#changed-keys)
  - [Key and prefix filters](#key-and-prefix-filters)
- [Asset holders](#asset-holders)
- [Simulate](#simulate)
- [Query](#query)
- [Simulate limits](#simulate-limits)
- [Busy, time limit and history errors](#busy-time-limit-and-history-errors)
- [Response headers](#response-headers)
- [Optional node features](#optional-node-features)
- [Bug fixes and changes to upstream code](#bug-fixes-and-changes-to-upstream-code)
- [Releasing dtalgosdk](#releasing-dtalgosdk)

## Summary

| Area                                              | algosdk                                              | dtalgosdk                                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Client                                            | `Algodv2` / `AlgodClient`                            | also `DTAlgodClient`, a subclass, with `DTAlgodClient.from(existingAlgod)`                                                          |
| Account, asset, application, box and supply reads | latest round only                                    | `.round(R)` on each read                                                                                                            |
| History                                           | none (use an indexer)                                | `...Versions` methods: the rounds at which an account, asset, application, box or any of an app's boxes changed, with paging        |
| History as of rounds                              | none                                                 | `rounds([...])` on the `...Versions` methods: each object as of each listed round, with the round it last changed (`changedRound`)  |
| Changed state keys                                | none                                                 | `include('keys')` on the application state versions: the global or local state keys each version changed (`changedKeys`)            |
| History of one key or box map                     | none                                                 | `key()` on the application and local state versions (with `keyValue`), `prefix()` on the boxes versions                             |
| Asset holders                                     | none (use an indexer)                                | `getAssetHolders(assetId)`: every holder of an asset at a round, paged with the round pinned                                        |
| Simulate: groups per request                      | one                                                  | several (node's `MaxAPISimulateGroups`, default 16), in sequence or with `parallelGroups()`                                         |
| Simulate: rounds per request                      | one (`round`)                                        | several with `rounds([...])` (node's `MaxAPISimulateRounds`, default 16)                                                            |
| Simulate: validity window                         | must contain the simulated round                     | `skipValidityWindow()` or `rewriteValidityWindow()` to simulate rounds far apart                                                    |
| Simulate: consensus protocol                      | the round's own                                      | `protocol('v42' \| 'latest' \| ...)` to run under a later protocol                                                                  |
| Simulate results                                  | `txnGroups`                                          | also `roundResults`, `protocolOverride`, and `groupResult()` / `groupResults()` that return each group's outcome or a typed error   |
| Request building                                  | `SimulateRequest`                                    | `DTSimulateRequest`, with `fromTransactions()` for unsigned transactions, and `packSimulateRounds()` to split rounds into requests  |
| Read-only TEAL calls                              | simulate with signed or empty-signature transactions | `query()`: one program or app, many calls, at many rounds, logs and cost per call                                                   |
| Node limits                                       | none                                                 | `simulateLimits()`, with the `query` limits                                                                                         |
| Errors                                            | HTTP errors                                          | `DTUnsupportedError` when the node lacks a feature, `SimulateGroupError` per failed group                                           |
| Busy, time limit and history errors               | HTTP errors                                          | `isNodeBusy`, `retryAfterSeconds`, `isTimeLimitExceeded`, `isRoundTooLarge`, `isHistoryUnavailable`                                 |
| Response headers                                  | dropped by `do()`                                    | `doWithHeaders()` on every request, `effortOf(headers)` for the node's `X-Algod-Effort`                                             |
| ABI                                               |                                                      | `ABIArrayDynamicType` and `ABITupleType` decode subarray views correctly (see [Bug fixes](#bug-fixes-and-changes-to-upstream-code)) |

## Installing in place of algosdk

Install dtalgosdk under the name `algosdk` with your package manager's override, so that your code and every dependency that uses algosdk (algokit-utils, use-wallet, ...) load the same single copy. Two copies break `instanceof` checks and mix transaction and model classes. Imports stay `from 'algosdk'`.

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

Then check that only one copy is installed: `npm ls algosdk` or `pnpm why algosdk` (`yarn why dtalgosdk` on Yarn) should list `dtalgosdk@3.9.0-dt.4.0.0.1` and nothing else.

Pin the exact version: dtalgosdk versions are prereleases, and ranges such as `^3.9.0` do not match them. A version reads `<algosdk version>-dt.<dt-algorand release>.<SDK release>`: `3.9.0-dt.4.0.0.1` is built on algosdk 3.9.0, covers the API of dt-algorand dt4 (`v5.0.5-dt4`), and is SDK release 0.0.1 for that pair.

To use a local checkout instead, run `npm run build` in it (and again after each change), then use it in place of the registry version. With pnpm, set the override to `link:/path/to/js-algorand-sdk`. With npm, put a tarball from `npm pack` in `dependencies` (`"algosdk": "file:./vendor/dtalgosdk-3.9.0-dt.4.0.0.1.tgz"`) and keep the override as `"$algosdk"`: npm rejects an override that differs from the direct dependency.

## New exports

From the package root (`import algosdk from 'algosdk'`):

- `DTAlgodClient`
- `DTUnsupportedError`, `SimulateGroupError`, and the types `SimulateGroupErrorKind`, `SimulateGroupOutcome`
- `packSimulateRounds`, and the types `PackedSimulateRounds`, `SimulateRoundsWindow`
- `DEFAULT_MAX_SIMULATE_GROUPS` (16), `DEFAULT_MAX_SIMULATE_ROUNDS` (16), `MAX_TXN_LIFE` (1000)
- `isNodeBusy`, `retryAfterSeconds`, `isTimeLimitExceeded`, `isRoundTooLarge`, `isHistoryUnavailable`
- `EFFORT_HEADER` (`x-algod-effort`), `parseEffortHeader`, `effortOf`, and the type `Effort`
- `TT_ROUND_HEADER` (`x-algod-tt-round`)
- `isQueryResponseTooLarge`, `MAX_QUERY_REQUEST_BYTES` (1,000,000), `QUERY_LOG_OVERHEAD_BYTES` (48), and the type `RunQuery` (the builder `query()` returns)
- the type `GetAssetHolders` (the builder `getAssetHolders()` returns)
- the types `VersionsOrder`, `VersionsInclude`, `StateVersionsInclude`, `AccountVersionsExclude`, `MAX_VERSIONS_ROUNDS` (10,000) and `MAX_VERSIONS_KEY_BYTES` (64)
- `dtModels`: the request and response models: `DTSimulateRequest`, `DTSimulateResponse`, `DTSimulationEvalOverrides`, `SimulateRoundResult`, `SimulateProtocolOverride`, `SimulateProtocolNote`, `SimulateProtocolNoteHit`, the type `SimulateProtocolNoteCode`, `SimulateLimitsResponse`, `QueryLimits`, `QueryRequest`, `QueryCall`, `QueryResponse`, `QueryRoundResult`, `QueryCallResult`, the types `QueryRequestParams`, `QueryCallParams`, `AssetHolder`, `AssetHoldersResponse`, `BoxChange`, and the `...Version` / `...VersionsResponse` models

`algosdk/client/algod` exports the same, with the models at its top level.

## DTAlgodClient

`DTAlgodClient` extends `AlgodClient` and takes the same constructor arguments. It overrides the reads that gain a `.round()`, `simulateTransactions` and `simulateRawTransactions`, and adds the versions, query, limits and detection methods. Every other method is inherited unchanged.

```typescript
const algod = new algosdk.DTAlgodClient(token, server, port);
```

To reuse a client you already have, such as algokit-utils' `algorand.client.algod`:

```typescript
const algod = algosdk.DTAlgodClient.from(algorand.client.algod);
```

`from` sends requests through the existing client's HTTP client (same server, token, headers and custom `BaseHTTPClient`), returns its argument if it already is a `DTAlgodClient`, and returns the same `DTAlgodClient` each time it is called with the same client, so cached answers (`supportsDT()`, `simulateLimits()`) are shared. The source client may come from another copy of algosdk, since it is read by shape, but transactions and models passed to the new client must come from this copy.

`supportsDT()` and `supportsAssetHolders()` say whether the node has the optional features they name; see [Optional node features](#optional-node-features).

`DTAlgodClient.features` lists what this build of the SDK has, for code that finds the class at runtime on an algosdk that may be stock algosdk rather than dtalgosdk, as algokit-utils and generated clients do: `reads-at-round`, `versions`, `simulate-groups`, `parallel-groups`, `simulate-rounds`, `from`, `group-results`, `from-transactions`, `pack-rounds`, `validity-window`, `simulate-protocol`, `simulate-limits`, `query`, `versions-rounds` (`rounds()` and `changedRound`), `versions-keys` (`include('keys')` and `changedKeys`), `versions-pages` (`pages()`), `holders` (`getAssetHolders`, `supportsAssetHolders`), `response-headers` (`doWithHeaders()`, `effortOf`, `parseEffortHeader`), `error-helpers` (`isNodeBusy`, `retryAfterSeconds`, `isTimeLimitExceeded`, `isRoundTooLarge`, `isHistoryUnavailable`), `round-header` (reads at a round check `X-Algod-TT-Round`, `TT_ROUND_HEADER`). It says nothing about the node: ask the node with `simulateLimits()`, `supportsDT()` and `supportsAssetHolders()`.

```typescript
const DT = (algosdk as any).DTAlgodClient;
if (DT?.features?.includes('group-results')) {
  const client = DT.from(algod);
}
```

## Reads at past rounds

These reads take `.round(R)`; without it they read the latest round, as in algosdk:

- `accountInformation(address)`
- `accountAssetInformation(address, assetId)`
- `accountAssetsInformation(address)`
- `accountApplicationsInformation(address)`
- `accountApplicationInformation(address, appId)`
- `supply()`
- `getAssetByID(assetId)`
- `getApplicationByID(appId)`
- `getApplicationBoxByName(appId, name)`
- `getApplicationBoxes(appId)`

```typescript
const box = await algod
  .getApplicationBoxByName(1234, boxName)
  .round(45_000_000)
  .do();

const boxes = await algod
  .getApplicationBoxes(1234)
  .round(45_000_000)
  .limit(100)
  .include('values')
  .do();
```

A dtalgod node with time travel off rejects `round` (400 `looking up past rounds requires EnableTimeTravel`, even for the latest round), thrown as a `DTUnsupportedError` with `requestedRound`.

A time travel node marks every answer given as of `R` with an `X-Algod-TT-Round: R` header: the 200, a 404 (not found at `R`) and the other errors of the lookup at `R`. Stock algod ignores `round` and answers with the latest state, without the header. So on a read at a round, `getAssetHolders` pages included, the client requires the header on a 200 or a 404: without it, or with another round, the answer is thrown as a `DTUnsupportedError` with `requestedRound` (and the 404 as its `cause`). A 404 marked with the round is the node's own 404, not found at that round. Other errors pass through as they are. `supportsDT()` tells a stock node apart once per client; the header also catches a load balancer that mixes nodes, where a later read lands on a stock node that would silently answer with its latest state.

A proxy in front of the node must pass the header on: one that strips it breaks every read at a round, which then fails loudly rather than risk a wrong answer. `getApplicationBoxes` is the exception: stock algod serves its `round` for its last few rounds, correctly but without the header, so the client checks the page's `round` instead, and throws a page for another round as a `DTUnsupportedError` (a node with `MaxAPIBoxPerApplication` 0 answers empty as of its latest round).

A node whose history is not trusted yet answers 503 `the time travel history is not served`, which `isHistoryUnavailable(err)` recognizes. `supply().round(R)` answers 404 for a round whose online stake the history does not record.

When listing boxes at a past round, pass the same round on every page. The `next` cursor is exclusive: only names that sort strictly after it are returned (upstream's OpenAPI description says otherwise and is wrong). Listing at a past round walks every box the app has ever had under the prefix, deleted ones included, so narrow it with `.prefix()` where you can.

## Versions: the rounds at which objects changed

| Method                                       | Lists the rounds at which ... changed                                       |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `getApplicationBoxVersions(appId, name)`     | one box: created, written or deleted                                        |
| `getApplicationBoxesVersions(appId)`         | any of an app's boxes, with the boxes that changed in each round            |
| `getApplicationVersions(appId)`              | an application's parameters, including creation and deletion                |
| `getAssetVersions(assetId)`                  | an asset's parameters, including creation and destruction                   |
| `accountVersions(address)`                   | anything `accountInformation` returns; each version lists only what changed |
| `accountAssetVersions(address, assetId)`     | the account's holding, and the asset's parameters if it created it          |
| `accountApplicationVersions(address, appId)` | the account's local state, and the app's parameters if it created it        |

A version is a round at which the stored value changed: rewriting an identical value is not a version, a deletion is. All of them take:

- `.minRound(R)` and `.maxRound(R)`: the range, inclusive (default 0 to the latest round). A page with an explicit `maxRound` never changes and can be cached.
- `.order('asc' | 'desc')`: oldest first (default) or newest first. For "the last N changes", use `.order('desc').limit(N)`.
- `.limit(N)`: versions per page (rounds per page with `rounds`), default 100, at most 10,000, or 1,000 with `values` or `keys`. A page also ends once its values reach 1 MB, before 100,000 lookups with `rounds`, and on newer builds at a 64 MB read budget, so only a missing `nextToken` means there are no more pages.
- `.next(token)`: the previous page's `nextToken`, passed back with the same other parameters. It stays valid as new blocks arrive.
- `.include('values')`: each version's new value (absent on deletions). The application state endpoints also take `keys` (see [Changed keys](#changed-keys)).
- `.rounds([...])`: the object as of each listed round instead of a range (see [Versions as of rounds](#versions-as-of-rounds)).
- `.pages()`: an async iterator over every page, empty ones included, until a page has no `nextToken`. A node that answers with the token it was sent throws an `Error` instead of paging forever.
- `.iterate()`: an async iterator over every version, fetching pages as it goes.

`accountVersions` also takes `.exclude('all' | 'none' | 'created-apps-params' | 'created-assets-params')`. Applying its versions after `minRound`, replacing objects by ID, to `accountInformation(address).round(minRound)` gives the account at any later round of the range.

```typescript
for await (const version of algod
  .getApplicationBoxVersions(1234, boxName)
  .include('values')
  .iterate()) {
  console.log(version.round, version.deleted, version.value);
}

const res = await algod
  .getApplicationBoxesVersions(1234)
  .order('desc')
  .limit(10)
  .do();
for (const version of res.versions) {
  console.log(
    version.round,
    version.boxes.map((b) => b.name)
  );
}
```

### Versions as of rounds

`.rounds([r1, r2, ...])` lists the object as of each listed round instead of its versions in a range: one entry per round, for the state at the end of that round, with `changedRound`, the round of the change in effect then. It samples history (a balance at each month end, a chart of global state) in one request instead of one read per round.

- Entries are deduplicated and come in `order` (ascending by default), not in request order: match them by `round`.
- An entry for a round at which the object did not exist has `deleted: true` and no `changedRound`. On the account endpoints, the objects that did not exist then are left out of the entry (`base` too).
- **Round 0 is the genesis round here.** In simulate and query `rounds`, 0 means the latest round.
- At most `MAX_VERSIONS_ROUNDS` (10,000) distinct rounds, none after the latest round, and not with `minRound` / `maxRound`. The client rejects too many rounds and the combination before sending.
- `limit` counts rounds, and `nextToken` is the next requested round, so `pages()` and `iterate()` page as usual.
- On the boxes endpoint, each entry lists every box of the app at that round, each with its `changedRound`. The node rejects a round with too many boxes to merge (400, `one round of boxes is too large`, or `too many objects to merge` beyond the node's object limit).
- The rounds go in the URL, about 9 bytes each: 10,000 rounds make a 90 KB URL, beyond the header limits of many proxies. Split long lists into several requests; the client does not.
- An empty box value can come back as `"value": null` from builds before the fix, and then reads as `value: undefined`, like a version without values.

```typescript
const res = await algod
  .getAssetVersions(31566704)
  .rounds([1000, 60_000_000])
  .include('values')
  .do();
for (const v of res.versions) {
  console.log(v.round, v.deleted ? 'did not exist' : `as of ${v.changedRound}`);
}
```

### Changed keys

`getApplicationVersions`, `accountVersions` and `accountApplicationVersions` take `.include('keys')`: each version of application parameters or local state then has `changedKeys`, the global or local state keys added, removed or given a new value in that round, sorted, as bytes. It is net over the round: a key set and deleted again within the round is not listed.

- On creation or opt-in, every key of the new state.
- `[]` when only other parameters changed (a program update); absent (`undefined`) on deletions, and on created apps with `exclude('created-apps-params')`.
- `keys` lowers the largest `limit` to 1,000, like `values`, and the 1 MB budget counts the previous values the keys are found from.

```typescript
for await (const v of algod
  .getApplicationVersions(1284326447)
  .order('desc')
  .limit(10)
  .include('keys')
  .iterate()) {
  console.log(
    v.round,
    v.changedKeys?.map((k) => new TextDecoder().decode(k))
  );
}
```

### Key and prefix filters

- `getApplicationVersions(appId).key(K)` lists only the versions at which global state key `K` changed: added, removed, or a new value or type, net over the round. Each entry has `keyValue` (a `TealValue`), the key's new value, absent when the key was removed or the app deleted.
- `accountApplicationVersions(address, appId).key(K)` does the same for a local state key. Its entries then list the local state only, never the app's parameters.
- `getApplicationBoxesVersions(appId).prefix(P)` lists only the changes of the boxes whose names start with `P` (one ARC-56 box map, say). Rounds in which none of them changed are left out. With `rounds()`, only the boxes under `P` are merged, so the node's per-app box bound counts only those.

Keys and prefixes are bytes (`Uint8Array`), sent in the node's app-arg form as `b64:...`: encode a string key yourself (`new TextEncoder().encode('total_effort')`). At most `MAX_VERSIONS_KEY_BYTES` (64) bytes; an empty key is allowed, an empty prefix is not. `key()` cannot be combined with `rounds()`; `prefix()` can. The client rejects the rest before sending.

There is no index of state keys, and box prefixes step through the app's whole box index: a page examines at most 100,000 versions (key) or 1,000,000 index entries (prefix), so it can hold fewer than `limit` versions, or none, and still have a `nextToken`. Use `pages()` or `iterate()`, which keep going until it is absent.

```typescript
for await (const v of algod
  .getApplicationVersions(1284326447)
  .key(new TextEncoder().encode('total_effort'))
  .order('desc')
  .iterate()) {
  console.log(v.round, v.keyValue?.uint);
}
```

The node rejects `key` or `prefix` on an endpoint it does not apply to with a 400, which passes through.

## Asset holders

`getAssetHolders(assetId)` lists the accounts that hold an asset at a round (the latest by default, or `.round(R)`), in address order, each with `address` (a string, as on `Account`), `amount` and `isFrozen`. Accounts opted in with a zero balance are listed. It needs a time-travel node with the asset holders index (`TimeTravelHoldersIndex`).

- `.limit(N)`: holders per page, default 1,000, from 1 to 10,000. A page also stops after examining 100,000 accounts that ever held the asset, so it can be short or empty while more remain: only a missing `nextToken` ends the list.
- Every page must be read at the same round. `.pages()` and `.iterate()` send the first page's `round` with every later page when no `.round()` was set. A manual `.next(token)` loop must pass `.round(first.round)` too.
- A page read at a round (`.round()`, or the pinned round) must carry `X-Algod-TT-Round` with that round, a 404 included, as for the [reads at a round](#reads-at-past-rounds); otherwise it is thrown as a `DTUnsupportedError`.

```typescript
let supplyHeld = 0n;
for await (const h of algod
  .getAssetHolders(31566704)
  .round(50_000_000)
  .iterate()) {
  supplyHeld += h.amount;
}
```

Errors:

- time travel off (a 404 `Not Found`: the route is only registered with `EnableTimeTravel`) or the holders index off (400 `asset holders require EnableTimeTravel and TimeTravelHoldersIndex`): `DTUnsupportedError`. `supportsAssetHolders()` finds out first;
- an asset that does not exist at the round, also a round before its creation: the node's 404 `asset does not exist`, passed through;
- an index still being built: 503 `the asset holders index is not complete`, passed through; `isHistoryUnavailable(err)` recognizes it.

## Simulate

`DTAlgodClient.simulateTransactions(request)` accepts a stock `SimulateRequest` or a `dtModels.DTSimulateRequest`, which adds the fork's fields. Each field can also be set on the request builder.

### Several groups

`txnGroups` may hold several groups, up to the node's `MaxAPISimulateGroups` (default 16). By default they run in order as consecutive groups of one simulated block:

- each group sees the effects of the groups before it;
- a transaction or lease used by an earlier group is a duplicate;
- the groups share the block's byte limit, so a group that does not fit fails while a smaller later group may still fit;
- a group that fails is rolled back and later groups still run, except after a failed post-evaluation check (placeholder PQ signatures with `fixSigners`) or a corrupted evaluator, after which every later group is reported as not simulated;
- each group's failure is in its own `failureMessage` / `failedAt` (0-based), and `extraOpcodeBudget` applies to each group.

With `.parallelGroups()` (or `parallelGroups: true`), every group is simulated alone against the state at the start round, concurrently. Groups then do not see each other's effects, duplicates are not detected across groups, and several groups may create the same app or asset ID.

`simulateRawTransactions` takes one signed transaction, one group, or several groups (`Uint8Array[][]`).

`DTSimulateRequest.fromTransactions(groups, fields)` builds a request from unsigned transactions, one array per group, such as `TransactionComposer.buildTransactions()` output. It sends empty signatures, defaults `allowEmptySignatures` to true, and assigns a group ID to a multi-transaction group that has none (it never recomputes one, so build new transactions for each request).

```typescript
const request = algosdk.dtModels.DTSimulateRequest.fromTransactions(
  [group1Txns, group2Txns],
  { allowUnnamedResources: true, parallelGroups: true }
);
const res = await algod.simulateTransactions(request).do();
```

### Several rounds

With `.rounds([...])` (or `rounds` on the request), the request is simulated once per listed round, up to the node's `MaxAPISimulateRounds` (default 16) entries. 0 means the latest round. Results are in `roundResults`, one per entry in request order, each with `lastRound`, `txnGroups`, `initialStates`, `protocolOverride` and, when that round could not be simulated, `error` (the request as a whole still succeeds). The top-level `lastRound` is then 0 and `txnGroups` is empty, so `AtomicTransactionComposer.simulate`, which reads the top level, cannot be used with `rounds`: call the client directly. A non-time-travel node can only simulate its last few rounds.

Simulating at round R evaluates the transactions as if in block R + 1, so without a validity window mode they need `firstValid <= R + 1 <= lastValid`, and a transaction is valid for at most 1000 rounds. `packSimulateRounds(rounds, { maxRounds, maxSpan })` packs a list of rounds into as few requests as possible under those rules. It returns `windows` (each with `rounds`, `firstValid` and `lastValid` to build that request's transactions with) and `positions` (where each input round's results are). Round 0 is rejected: look up the latest round with `status()` first.

```typescript
const { maxTxnGroups, maxRounds } = await algod.simulateLimits();
const { windows, positions } = algosdk.packSimulateRounds(rounds, {
  maxRounds,
});
const responses = await Promise.all(
  windows.map((w) =>
    algod
      .simulateTransactions(
        algosdk.dtModels.DTSimulateRequest.fromTransactions(
          buildGroups(w.firstValid, w.lastValid), // up to maxTxnGroups groups
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

### Validity window modes

Both modes need `rounds`, and they cannot be combined. With either, `packSimulateRounds(rounds, { maxSpan: null })` packs by the round limit only.

- `.skipValidityWindow()`: transactions are evaluated as sent at every round, outside their window. The round-range check and the check for a transaction already confirmed are skipped; leases, duplicates within the block, genesis ID and hash, well-formedness and fees are still checked. Programs see the original window, so `block`, `FirstValidTime` and inner transactions stay tied to it, and reading a block after the start round fails.
- `.rewriteValidityWindow()`: at every round each top-level transaction's window is moved to the simulated block, keeping its width, and valid group IDs are recomputed. Signatures over changed transactions are dropped, so it needs `allowEmptySignatures`; logic signatures are kept. Transaction IDs change: match results by group index, not transaction ID, and give transactions that differ only by their window distinct notes, or the later one is a duplicate.

### Later consensus protocol

`.protocol(p)` runs the simulated round under a later consensus protocol, as if an upgrade to it took effect right after the start round: its programs, limits, fees and other parameters apply, to previously deployed programs too. `p` is a consensus version string, `v24` to `v43` for mainline ones, `latest` (the protocol of the block after the node's latest), or `future` (only with `EnableDeveloperAPI`). It must be later than the protocol the round really ran.

`protocolOverride` on the response (on each round result, with `rounds`) has `from`, `to`, `applied` (false when `from` already is `to`) and `notes`: where the simulation differs from what the chain recorded, with codes `semantics-changed`, `no-heartbeat-challenges`, `no-load-history`, `block-incentive-fields`, `block-hash-fields`, `online-stake-includes-expired`, `account-incentive-fields` and `app-version-starts-at-upgrade`.

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

### Reading results

`DTSimulateResponse` adds:

- `groupResult(groupIndex, roundIndex = 0)`: one group at one round, as `{ ok: true, result }` or `{ ok: false, error }`;
- `groupResults()`: every outcome, indexed `[roundIndex][groupIndex]`, with a single row when the request listed no rounds.

The `error` is a `SimulateGroupError` with `kind`:

- `round`: the round could not be simulated (the round result's `error`);
- `group`: the group failed (`failureMessage`, and `failedAt` when the node blamed one transaction);
- `not-simulated`: the group was skipped after an earlier group failed a post-evaluation check;
- `missing`: the response has no result for the group.

It also has `roundIndex`, `groupIndex`, `round`, and, for `group` and `not-simulated`, `result` with the transactions that ran before the failure.

The node may raise the limits on unnamed resources (`allowUnnamedResources`) with its `SimulateResourceLimitMultiplier` setting, so the resources it reports may not fit in a group that can be submitted.

## Query

`DTAlgodClient.query(request)` runs read-only TEAL calls through the fork's `POST /v2/query`: one program or one deployed app, many calls, at many rounds, in one request, with no transactions to build. It is what a "ghost" simulate (an app create that logs its results) does, without signatures, fees, validity windows or group limits.

- With `program`, each call creates an app running it (at the app ID the next block would give it); with `appId`, each call is a NoOp call of that deployed app. Exactly one of them is required.
- Each call is an app call alone in its group, in the block after each queried round, on the state that round left. There are no signatures, fees, minimum balances or leases, and every resource is available unnamed: references are only needed by programs before v9, which address resources by index.
- Writes are dropped after each call, so calls do not see each other's effects. Inner transactions run but are not echoed, nor are state changes. A failed call does not affect the others.

| Request field                 | Meaning                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `program`                     | approval program of the app each call creates, bytes or base64 (as `compile().do().result`); extra pages follow from its size                   |
| `clearProgram`                | its clear program; defaults to `pushint 1` at the version of `program`, which must then be v3 or later                                          |
| `globalSchema`, `localSchema` | its state schemas (`{ numUint, numByteSlice }`)                                                                                                 |
| `appId`                       | the deployed app to call instead; not with the three fields above                                                                               |
| `sender`                      | sender of every call; defaults to the fee sink                                                                                                  |
| `rounds` / `.rounds([...])`   | rounds to query, 0 for the latest; defaults to the latest; a round after the latest one fails the request                                       |
| `protocol` / `.protocol(p)`   | protocol to run under: `latest` by default, a later version, `round` for the chain's own, `future` with the developer API                       |
| `budget`                      | opcode budget of each call, shared with the apps it calls; defaults to and is capped by `maxCallBudget`                                         |
| `calls`                       | at least one; each with `args` (bytes), `accounts`, `foreignApps`, `foreignAssets`, `boxes` (app 0 is the called app; names as bytes or base64) |

The request and its calls may be models (`dtModels.QueryRequest`, `QueryCall`) or plain objects; ids and rounds take `number` or `bigint`, addresses strings or `Address`.

```typescript
const res = await algod
  .query({
    program: (await algod.compile(source).do()).result,
    calls: [{ args: [selector, arg1] }, { args: [selector, arg2] }],
  })
  .rounds([0, 50_000_000])
  .do();
for (const r of res.rounds) {
  r.calls.forEach((call, i) =>
    console.log(r.round, i, r.error ?? call.error ?? call.logs)
  );
}
```

### Results

`res.rounds` has one entry per entry of `rounds`, in order (one for the latest round when none were listed); `res.lastRound` is the node's latest round when the request started. Each entry has:

- `round`: the queried round, with 0 resolved to the latest round;
- `error`: why the round could not be queried, with no `calls` then;
- `calls`: one result per call, in order, each with `logs` (the called app's logs, also those written before a failure), `cost` (the opcode budget used, the apps it called included) and `error`;
- `protocolOverride`: how the protocol applied (as in simulate; wire key `protocol`).

The client checks that the response has one entry per round, for the round asked for, and one result per call, and throws an `Error` otherwise. `doRaw()` returns the msgpack body unchecked.

### Differences from simulate

Code that falls back from query to simulate (or back) must handle these:

- **Default protocol**: query runs under `latest` by default, so a past round runs today's rules and reports a `protocolOverride` with `applied` true and notes; simulate runs the round's own protocol. Pass `.protocol('round')` to query for the chain's own rules, or `.protocol('latest')` to simulate for today's.
- **Budget**: a query call gets at most `maxCallBudget` (320,000 by default), while a simulate group can get `maxExtraOpcodeBudget` plus the budget of its transactions. Compare a call's needs with `maxCallBudget` before choosing query.
- **Errors**: a query call's `error` is the bare evaluation error (`logic eval error: ...`); simulate's `failureMessage` is prefixed (`transaction N: ...`).
- **Logs**: query returns only the called app's logs, with no inner transaction or state echo. `maxCallLogBytes` can raise the log limit per program above the protocol's 1024 bytes in 32 logs.

### Limits and errors

`(await algod.simulateLimits()).query` has the node's `QueryLimits`, or is undefined when the node has no query endpoint or has queries disabled:

- `maxCalls` calls and `maxRounds` round entries (duplicates included) per request;
- `maxCallBudget`, the most (and default) budget per call;
- `maxCallLogBytes`, the most bytes each program of a call may log, in up to 2048 logs (0 for the protocol's limits);
- `maxResponseBytes`, the most bytes of logs and errors a request may return (0 for no limit). Each log counts `QUERY_LOG_OVERHEAD_BYTES` (48) more than its length, and a round listed twice counts twice.

The request body may be at most `MAX_QUERY_REQUEST_BYTES` (1,000,000) bytes of msgpack (`encodeMsgpack(request).length`), a fixed limit of the node that the limits endpoint does not report. The client checks none of these.

- A node with queries disabled (`MaxAPIQueryCalls` 0: a 400 saying so) is thrown as a `DTUnsupportedError`.
- Results over `maxResponseBytes` fail with a 400 that `isQueryResponseTooLarge(err)` recognizes: split the request and retry.
- Other 400s (too many calls or rounds, a round after the latest, an unknown protocol, a bad address) pass through.
- A busy node answers 503 with `Retry-After` (query shares simulate's limiter), and a request over `timeLimitSeconds` 504.

Detect query and fall back, splitting calls by `maxCalls` and rounds by `maxRounds` (the SDK ships no chunker):

```typescript
const { query } = await algod.simulateLimits();
if (!query) {
  // simulate instead
} else {
  const results = [];
  for (let r = 0; r < rounds.length; r += query.maxRounds) {
    for (let c = 0; c < calls.length; c += query.maxCalls) {
      results.push(
        await algod
          .query({ program, calls: calls.slice(c, c + query.maxCalls) })
          .rounds(rounds.slice(r, r + query.maxRounds))
          // The chain's own rules: a program newer than an old round's
          // protocol then fails in every call's `error` at that round.
          .protocol('round')
          .do(undefined, { signal }) // abortable
      );
    }
  }
}
```

## Simulate limits

`simulateLimits()` reads `GET /v2/transactions/simulate/limits` once per client and returns a frozen `SimulateLimitsResponse`:

| Field                     | Meaning                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxTxnGroups`            | groups per request                                                                                                                                                            |
| `maxRounds`               | `rounds` entries per request; 0 when `rounds` is off                                                                                                                          |
| `maxExtraOpcodeBudget`    | most `extraOpcodeBudget`, per group                                                                                                                                           |
| `resourceLimitMultiplier` | the node's `SimulateResourceLimitMultiplier`                                                                                                                                  |
| `timeTravel`              | `EnableTimeTravel` is on                                                                                                                                                      |
| `developerApi`            | `EnableDeveloperAPI` is on (`execTraceConfig`, protocol `future`)                                                                                                             |
| `timeLimitSeconds`        | how long the node works on a simulate, query, versions or delta request before a 504, 0 for no limit                                                                          |
| `query`                   | `QueryLimits` of `POST /v2/query` (`maxCalls`, `maxCallBudget`, `maxCallLogBytes`, `maxCallStateBytes`, `maxResponseBytes`, `maxRounds`); undefined when queries are disabled |
| `reported`                | the node reported these; false for the fallback below                                                                                                                         |

A 0 limit from the node means no limit. `query` is frozen too.

Every dtalgod node serves the limits, so stock algod is the only node without them: it gets stock algod's limits instead (`SimulateLimitsResponse.stock()`), with `reported` false: one group per request, no `rounds`, no time travel and no queries, so send one request per round with `round` set. `getSimulateLimits()` is the uncached request, which throws `DTUnsupportedError` on a 404.

## Busy, time limit and history errors

Helpers that take the error a request threw (an HTTP error from `HTTPClient`, with `status` and `response`) and say what kind of failure it is. They match the status and the node's message, not headers.

| Helper                      | Matches                                                                                                                                                                                          | What to do                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `isNodeBusy(err)`           | 503 "the node is busy" (simulate, query, versions and deltas share a concurrency limit), or "every slot for re-evaluating old rounds is in use" (deltas of rounds older than the in-memory ones) | retry after `retryAfterSeconds(err) ?? 1` seconds, or on another node           |
| `retryAfterSeconds(err)`    | the `Retry-After` header, in seconds or as an HTTP date; undefined without one                                                                                                                   | a delay for the retry                                                           |
| `isTimeLimitExceeded(err)`  | 504, the node's time limit (`RestWriteTimeoutSeconds`; `timeLimitSeconds` in `simulateLimits()`)                                                                                                 | split the request (fewer groups, calls, rounds, a smaller page); don't retry it |
| `isRoundTooLarge(err)`      | 400 "one round of boxes is too large" (boxes versions with `rounds`) or "too many objects to merge" (account versions, or boxes versions with `rounds`)                                          | narrow it: a box `prefix()`, fewer objects, or reads at that round              |
| `isHistoryUnavailable(err)` | 503 "the box index is incomplete", "the asset holders index is not complete" or "the time travel history is not served"                                                                          | fall back to reads at a round, another node or an indexer; retrying soon fails  |

```typescript
for (let attempt = 0; ; attempt++) {
  try {
    return await algod.query(request).do();
  } catch (err) {
    if (!algosdk.isNodeBusy(err) || attempt >= 3) throw err;
    await sleep(1000 * (algosdk.retryAfterSeconds(err) ?? 1));
  }
}
```

## Response headers

`doWithHeaders()` runs any request as `do()` does, with the same checks, and returns `{ data, headers }`, the headers keyed by lowercased name. An HTTP error has them too, in `err.response.headers`.

A dt-algorand node with `EnableEffortHeader` reports the work each request did in `X-Algod-Effort`, an RFC 9651 dictionary (`opcodes=700, lookups=3, history=2, scanned=10, response-bytes=512, eval-us=840`). `effortOf(headers)` parses it into an `Effort` (`opcodes`, `lookups`, `history`, `scanned`, `responseBytes`, `evalMicroseconds`), or gives undefined when it is absent or malformed (`parseEffortHeader(value)` takes the value itself). It is off by default and meant for a load balancer that bills on it and strips it, so most clients never see it: use it for diagnostics only.

```typescript
const { data, headers } = await algod
  .getApplicationVersions(1234)
  .doWithHeaders();
console.log(data.versions.length, algosdk.effortOf(headers)?.lookups);
```

A read at a round answers with `X-Algod-TT-Round` (`TT_ROUND_HEADER`), the round it was answered as of, which the client checks (see [Reads at past rounds](#reads-at-past-rounds)).

dt-algorand lists `Retry-After`, `X-Algod-Effort` and `X-Algod-TT-Round` in `Access-Control-Expose-Headers`, so browsers can read them on a cross-origin request. A proxy in front of the node may still drop them, so have a default for `retryAfterSeconds`.

## Optional node features

dtalgosdk covers the API of the current dt-algorand release. Every dt-algorand node has the limits endpoint, several groups per simulate request, `parallelGroups()`, `protocol()` and the query endpoint; the rest depends on its config. `simulateLimits()` reads it once per client, and only the asset holders index needs a probe of its own:

| Feature                                                                 | Node config                                | How to tell                                                    | When off                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Time travel: reads at past rounds, `...Versions`, simulate at any round | `EnableTimeTravel`                         | `supportsDT()` (`timeTravel` of the limits)                    | `DTUnsupportedError` (the `/versions` and holders routes 404, `round` is a 400)  |
| Asset holders                                                           | `TimeTravelHoldersIndex` (and time travel) | `supportsAssetHolders()`, one probe that reads nothing, cached | `DTUnsupportedError`; an index not built yet is a 503 for `isHistoryUnavailable` |
| Query                                                                   | `MaxAPIQueryCalls` above 0                 | `query` of the limits                                          | `DTUnsupportedError`                                                             |
| Simulate `rounds` and the validity window modes                         | `MaxAPISimulateRounds` above 0             | `maxRounds` of the limits                                      | `DTUnsupportedError`                                                             |
| Several groups per simulate request                                     | `MaxAPISimulateGroups` above 1             | `maxTxnGroups` of the limits                                   | the node's 400 `too many transaction groups`                                     |
| Execution traces, protocol `future`                                     | `EnableDeveloperAPI`                       | `developerApi` of the limits                                   | the node's 400                                                                   |
| `X-Algod-Effort`                                                        | `EnableEffortHeader`                       | the header is present                                          | `effortOf(headers)` is undefined                                                 |

Against stock algod, `DTAlgodClient` works for everything inherited from `AlgodClient`. `simulateLimits()` falls back to stock algod's limits (`reported` false), so `supportsDT()` and `supportsAssetHolders()` are false and `query` is undefined. Gate the additions on these: stock algod ignores `round` and answers with the latest state (a read at a round throws `DTUnsupportedError`, as the answer has no `X-Algod-TT-Round`), rejects the fork's simulate fields with its own 400, and answers the fork's routes unevenly: `getAssetVersions`, `accountAssetVersions`, `accountApplicationVersions` and `getAssetHolders` get its router's 400 (`Invalid format for parameter asset-id` or `application-id`), thrown as the plain HTTP error, while the other `...Versions` methods get a 404, thrown as a `DTUnsupportedError` that says time travel is off.

## Bug fixes and changes to upstream code

- `ABIArrayDynamicType.decode` and `ABITupleType.decode` read the length prefix and offsets from the start of the underlying `ArrayBuffer` instead of the start of the `Uint8Array` passed in. Decoding a subarray (for example a value sliced out of a log or box) read the wrong bytes. They now read at the view's `byteOffset`, and a dynamic array shorter than its 2-byte length prefix throws a clear error.

- `URLTokenBaseHTTPClient` built the `headers` of responses and HTTP errors with names and values swapped (`{ "1": "retry-after" }`), because `Headers.forEach` passes the value first. They are now keyed by the lowercased header name (`{ "retry-after": "1" }`), so retry logic can read `Retry-After` from a 503.

- `base64ToBytes` and `bytesToBase64` without Node's `Buffer` (browsers) built the bytes with `Uint8Array.from` and a callback, and the string one `String.fromCodePoint` per byte. They now use a `charCodeAt` loop and `String.fromCharCode` over 32 KB chunks: for 32 KB, 0.13 ms instead of 3.6 ms to decode and 0.29 ms instead of 2.3 ms to encode. Every box value, program, state key and `changedKeys` entry decoded in a browser goes through them. Node keeps using `Buffer`.

- `JSONRequest` gains `doWithHeaders()`, which returns the decoded data and the response headers (lowercased names). It runs `executeRequest` then `prepare`, so every subclass's checks apply as in `do()`.

- `Address.fromString` keeps the public keys of the last 10,000 address strings whose checksum it checked, so a string seen again skips the base32 decode and the SHA-512/256 checksum (it returns a new `Address` with its own copy of the key). Simulate responses repeat the same unnamed accounts in every group and round: decoding the unnamed resources of 16 rounds × 16 groups over 16 accounts takes 4.6 ms instead of 25 ms.
- `Address.toString` (and so `encodeAddress` and the ABI `address` decode) keeps the strings of the last 10,000 public keys it encoded, keyed by the key's bytes, so a key seen again skips the SHA-512/256 checksum and the base32 encode. Decoding ABI addresses from the logs of a read at many rounds encodes the same keys in every round: 2,000 keys × 64 rounds take about 30–55 ms instead of 450–560 ms.

## Releasing dtalgosdk

GitHub Actions publishes dtalgosdk, with [`.github/workflows/dtalgosdk.yml`](.github/workflows/dtalgosdk.yml). On every push and pull request to `dtalgorand` it runs the linters, the type checks and the tests. On a `v<version>` tag it also checks the release, publishes it to npm with provenance, and creates a GitHub release with the package tarball and the browser bundle. Upstream's workflows that release or open pull requests (`release.yml`, `prod_release.yml`, `codegen.yml`) run only on algorand/js-algorand-sdk.

1. Choose the version, `<algosdk version>-dt.<dt-algorand release>.<SDK release>`:
   - the algosdk version the code is built on; change it when merging a new upstream release;
   - the number of the latest dt-algorand release (`v5.0.4-dt2` is 2) whose API the SDK covers. Nodes of older dt-algorand releases are not supported; the client detects only the optional features of the current release (see [Optional node features](#optional-node-features)). Keep the dot (`dt.2`, not `dt2`), so that npm compares it as a number and `dt.10` sorts after `dt.9`;
   - the SDK's own release, `x.y.z`: bump `x` for a breaking change to the fork's API, `y` for features and `z` for fixes. Reset it to `0.0.1` when either of the parts before it changes.
2. Set it and update the docs: `npm version <version> --no-git-tag-version`, `npm run build`, then `node scripts/ci/dtalgosdk-release.js update`. The script sets the version in the install snippets and CDN URLs in `README.md` and in this file, and the browser bundle's `integrity` hash in `README.md`.
3. `npm test`, then `npm pack --dry-run` to check the contents (`dist/`, `src/`, `README.md`, `DTALGOSDK.md`, `LICENSE`).
4. Commit and push `dtalgorand`, then tag the commit and push the tag: `git tag v<version>` and `git push d13co v<version>`.
5. The workflow checks that the tag is on `dtalgorand` and matches the version in `package.json` and `package-lock.json`, and that the docs name that version and the bundle's hash (`node scripts/ci/dtalgosdk-release.js check v<version>` runs the same check locally). It then runs the tests and publishes with `npm publish --tag latest`: npm 11 publishes a prerelease only with an explicit tag, and `latest` makes it the version `npm install dtalgosdk` gets. If the version is already on npm, the workflow does not publish it again and only creates the GitHub release.

### One-time setup

- **Default branch.** Set it to `dtalgorand` (Settings → General). The guards that keep upstream's workflows off the fork exist only on this branch, and GitHub runs scheduled workflows such as `codegen.yml` from the default branch. It also makes the repository page show this branch's README.
- **First version, by hand.** The workflow publishes only through npm trusted publishing, which is set up on a package that already exists. Publish the first version from a checkout: steps 1 to 3, then `npm publish --tag latest`, then push the tag (step 4). The workflow sees that the version is on npm, skips publishing, and creates the GitHub release.
- **Trusted publisher.** Right after the first publish, add one for the workflow, either in the package's settings on npmjs.com (Trusted publishing → GitHub Actions: owner `d13co`, repository `dt-js-algorand-sdk`, workflow `dtalgosdk.yml`, environment `npm`, publishing allowed) or with npm 11.5.1 or later: `npm trust github dtalgosdk --file dtalgosdk.yml --repo d13co/dt-js-algorand-sdk --env npm --allow-publish`. Publishing is not allowed unless it is turned on. npm drops a new trusted publisher if nothing is published with it within 2 days, so set it up when the next release is close, or add it again later. Trusted publishing adds provenance to each version, and needs no token.
- **Approval (optional).** The publish job runs in the GitHub environment `npm`, which GitHub creates on the first run. To approve each release by hand, add required reviewers to it under Settings → Environments.
