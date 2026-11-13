# dt-algosdk: differences from algosdk

`dt-algosdk` is [algosdk](https://www.npmjs.com/package/algosdk) v3.9.0 with additions for a time-travel algod: a node built from [dt-algorand](https://github.com/d13co/dt-algorand/tree/dtalgorand), the time-travel fork of go-algorand, and run with `EnableTimeTravel: true`, which keeps the state of every round since genesis. Everything in algosdk is unchanged and keeps working against stock algod; the additions are new exports, so code written for algosdk runs on dt-algosdk as is.

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
- [Capabilities](#capabilities)
- [Busy, time limit and history errors](#busy-time-limit-and-history-errors)
- [Response headers](#response-headers)
- [Optional node features](#optional-node-features)
- [Bug fixes and changes to upstream code](#bug-fixes-and-changes-to-upstream-code)
- [Releasing dt-algosdk](#releasing-dt-algosdk)

## Summary

| Area                                              | algosdk                                              | dt-algosdk                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Client                                            | `Algodv2` / `AlgodClient`                            | also `DTAlgodClient`, a subclass, with `DTAlgodClient.from(existingAlgod)`                                                                 |
| Account, asset, application, box and supply reads | latest round only                                    | `.round(R)` on each read                                                                                                                   |
| History                                           | none (use an indexer)                                | `...Versions` methods: the rounds at which an account, asset, application, box or any of an app's boxes changed, with paging               |
| History as of rounds                              | none                                                 | `rounds([...])` on the `...Versions` methods: each object as of each listed round, with the round it last changed (`changedRound`)         |
| Changed state keys                                | none                                                 | `include('keys')` on the application state versions: the global or local state keys each version changed (`changedKeys`)                   |
| History of one key or box map                     | none                                                 | `key()` on the application and local state versions (with `keyValue`), `prefix()` on the boxes versions                                    |
| Asset holders                                     | none (use an indexer)                                | `getAssetHolders(assetId)`: every holder of an asset at a round, paged with the round pinned                                               |
| Simulate: groups per request                      | one                                                  | several (node's `MaxAPISimulateGroups`, default 16), in sequence                                                                           |
| Simulate: round                                   | the node's last few rounds                           | any round since genesis with `round`                                                                                                       |
| Simulate results                                  | `txnGroups`                                          | also `groupResult()` / `groupResults()`, which return each group's outcome or a typed error                                                |
| Request building                                  | `SimulateRequest`                                    | `DTSimulateRequest`, with `fromTransactions()` for unsigned transactions                                                                   |
| Read-only TEAL calls                              | simulate with signed or empty-signature transactions | `query()`: one program or app, many calls, at many rounds, logs and cost per call                                                          |
| Node features and limits                          | none                                                 | `capabilities()`: time travel, developer API, time limit, and the `simulate` and `query` limits                                            |
| Errors                                            | HTTP errors                                          | `DTUnsupportedError` when the node lacks a feature, `SimulateGroupError` per failed group                                                  |
| Busy, time limit and history errors               | HTTP errors                                          | `isNodeBusy`, `isTooManyRequests`, `retryAfterSeconds`, `isTimeLimitExceeded`, `isRoundTooLarge`, `isHistoryUnavailable`, `isNetworkError` |
| Retries                                           | none                                                 | `withRetry(baseClient, policy)`: one retry policy for busy nodes, rate limits and network errors, with `onWait` to tell users              |
| Response headers                                  | dropped by `do()`                                    | `doWithHeaders()` on every request, `effortOf(headers)` for the node's `X-Algod-Effort`                                                    |
| ABI                                               |                                                      | `ABIArrayDynamicType` and `ABITupleType` decode subarray views correctly (see [Bug fixes](#bug-fixes-and-changes-to-upstream-code))        |

## Installing in place of algosdk

Install dt-algosdk under the name `algosdk` with your package manager's override, so that your code and every dependency that uses algosdk (algokit-utils, use-wallet, ...) load the same single copy. Two copies break `instanceof` checks and mix transaction and model classes. Imports stay `from 'algosdk'`.

npm (`package.json`):

```json
{
  "dependencies": {
    "algosdk": "npm:dt-algosdk@3.9.0-dt.6.2.1.0"
  },
  "overrides": {
    "algosdk": "$algosdk"
  }
}
```

pnpm 10 and later (`pnpm-workspace.yaml`; pnpm 11 and later read overrides only from here):

```yaml
overrides:
  algosdk: npm:dt-algosdk@3.9.0-dt.6.2.1.0
```

pnpm 9 (`package.json`; it warns about an unmet `algosdk` peer dependency, which is harmless):

```json
{
  "pnpm": {
    "overrides": {
      "algosdk": "npm:dt-algosdk@3.9.0-dt.6.2.1.0"
    }
  }
}
```

Yarn and Bun (`package.json`):

```json
{
  "dependencies": {
    "algosdk": "npm:dt-algosdk@3.9.0-dt.6.2.1.0"
  },
  "resolutions": {
    "algosdk": "npm:dt-algosdk@3.9.0-dt.6.2.1.0"
  }
}
```

Yarn 4 refuses versions published less than a day ago (`npmMinimalAgeGate`). To install a new dt-algosdk release right away, add `npmPreapprovedPackages: ["dt-algosdk"]` to `.yarnrc.yml`.

Then check that only one copy is installed: `npm ls algosdk` or `pnpm why algosdk` (`yarn why dt-algosdk` on Yarn) should list `dt-algosdk@3.9.0-dt.6.2.1.0` and nothing else.

Pin the exact version, with no `^` or `~` (`npm install -E`): dt-algosdk versions are prereleases, so `^3.9.0` matches none of them, while a `^` or `~` range on a dt-algosdk version matches every later dt-algosdk built on the same algosdk version, breaking releases included. A version reads `<algosdk version>-dt.<dt-algorand release>.<SDK release>`: `3.9.0-dt.6.2.1.0` is built on algosdk 3.9.0, covers the API of dt-algorand dt6 (`v5.0.5-dt6`), and is SDK release 2.1.0. The SDK release counts on across new algosdk and dt-algorand versions; it never starts over.

To use a local checkout instead, run `npm run build` in it (and again after each change), then use it in place of the registry version. With pnpm, set the override to `link:/path/to/js-algorand-sdk`. With npm, put a tarball from `npm pack` in `dependencies` (`"algosdk": "file:./vendor/dt-algosdk-3.9.0-dt.6.2.1.0.tgz"`) and keep the override as `"$algosdk"`: npm rejects an override that differs from the direct dependency.

## New exports

From the package root (`import algosdk from 'algosdk'`):

- `DTAlgodClient`
- `DTUnsupportedError`, `SimulateGroupError`, and the types `SimulateGroupErrorKind`, `SimulateGroupOutcome`
- `DEFAULT_MAX_SIMULATE_GROUPS` (16)
- `isNodeBusy`, `isTooManyRequests`, `retryAfterSeconds`, `isTimeLimitExceeded`, `isRoundTooLarge`, `isHistoryUnavailable`, `isNetworkError`, `networkErrorCode`, `DEFAULT_NETWORK_ERROR_CODES`
- the retry policy ([Retries](#retries)): `withRetry`, `RetryingHTTPClient`, `callWithRetry`, `retryDecision`, `retryPolicy`, `DEFAULT_RETRY_POLICY`, `formatRetryWait`, `isTimeLimitedRequest`, `isNonIdempotentRequest`, `sleepUnlessAborted`, `RETRYING_CLIENT`, `isRetryingClient`, and the types `RetryPolicy`, `RetryOptions`, `RetryDecision`, `RetryReason`, `RetryWait`, `RetryWaitReason`, `RetryRequest`, `RetryContext`. `algosdk/client` exports them too.
- `EFFORT_HEADER` (`x-algod-effort`), `parseEffortHeader`, `effortOf`, and the type `Effort`
- `TT_ROUND_HEADER` (`x-algod-tt-round`)
- `isQueryResponseTooLarge`, `MAX_QUERY_REQUEST_BYTES` (1,000,000), `QUERY_LOG_OVERHEAD_BYTES` (48), and the type `RunQuery` (the builder `query()` returns)
- `QueryStreamError`, `QUERY_STREAM_TYPE` (`text/event-stream`), and the types `QueryStreamEvent`, `QueryStreamStartEvent`, `QueryStreamLogsEvent`, `QueryStreamCallEvent`, `QueryStreamRoundEvent`, `QueryStreamEndEvent` ([Streamed answers](#streamed-answers))
- the type `GetAssetHolders` (the builder `getAssetHolders()` returns)
- the types `VersionsOrder`, `VersionsInclude`, `StateVersionsInclude`, `AccountVersionsExclude`, `MAX_VERSIONS_ROUNDS` (10,000) and `MAX_VERSIONS_KEY_BYTES` (64)
- `dtModels`: the request and response models: `DTSimulateRequest`, `DTSimulateResponse`, `QueryProtocolOverride`, `QueryProtocolNote`, `QueryProtocolNoteHit`, the type `QueryProtocolNoteCode`, `CapabilitiesResponse`, `SimulateLimits`, `QueryLimits`, `QueryRequest`, `QueryCall`, `QueryResponse`, `QueryRoundResult`, `QueryCallResult`, the types `QueryRequestParams`, `QueryCallParams`, `AssetHolder`, `AssetHoldersResponse`, `BoxChange`, and the `...Version` / `...VersionsResponse` models

`algosdk/client/algod` exports the same, with the models at its top level, except the retry policy, which `algosdk/client` exports.

## DTAlgodClient

`DTAlgodClient` extends `AlgodClient` and takes the same constructor arguments. It overrides the reads that gain a `.round()`, `simulateTransactions` and `simulateRawTransactions`, and adds the versions, holders, query, capabilities and detection methods. Every other method is inherited unchanged.

```typescript
const algod = new algosdk.DTAlgodClient(token, server, port);
```

To reuse a client you already have, such as algokit-utils' `algorand.client.algod`:

```typescript
const algod = algosdk.DTAlgodClient.from(algorand.client.algod);
```

`from` sends requests through the existing client's HTTP client (same server, token, headers and custom `BaseHTTPClient`), returns its argument if it already is a `DTAlgodClient`, and returns the same `DTAlgodClient` each time it is called with the same client, so cached answers (`supportsDT()`, `capabilities()`) are shared. The source client may come from another copy of algosdk, since it is read by shape, but transactions and models passed to the new client must come from this copy. The HTTP client of algosdk 3.9.0 and earlier keys response headers by value (see [Bug fixes and changes to upstream code](#bug-fixes-and-changes-to-upstream-code)); the round, effort and `Retry-After` checks read both shapes, but `doWithHeaders()` returns the headers as that client gives them.

`supportsDT()` and `supportsAssetHolders()` say whether the node has the optional features they name; see [Optional node features](#optional-node-features).

`DTAlgodClient.features` lists what this build of the SDK has, for code that finds the class at runtime on an algosdk that may be stock algosdk rather than dt-algosdk, as algokit-utils and generated clients do: `reads-at-round`, `versions`, `simulate-groups`, `from`, `group-results`, `from-transactions`, `capabilities` (`capabilities()`, `getCapabilities()`), `query`, `query-total-calls` (`maxTotalCalls`), `query-stream` (`stream()` on `query()`, `postStream` on the HTTP clients, `stream` on the query limits), `query-opcodes` (`maxSeekRounds`, `maxCallScanBytes`, `maxScanStepBytes` and `opcodes` on the query limits), `versions-rounds` (`rounds()` and `changedRound`), `versions-keys` (`include('keys')` and `changedKeys`), `versions-pages` (`pages()`), `holders` (`getAssetHolders`, `supportsAssetHolders`), `response-headers` (`doWithHeaders()`, `effortOf`, `parseEffortHeader`), `error-helpers` (`isNodeBusy`, `retryAfterSeconds`, `isTimeLimitExceeded`, `isRoundTooLarge`, `isHistoryUnavailable`), `round-header` (reads at a round check `X-Algod-TT-Round`, `TT_ROUND_HEADER`), `retry-policy` (the [retry policy](#retries), `isTooManyRequests` and `isNetworkError`). It says nothing about the node: ask the node with `capabilities()`, `supportsDT()` and `supportsAssetHolders()`.

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
- `.pages()`: an async iterator over every page, empty ones included, until a page has no `nextToken`. A node that answers with a token it was already sent throws an `Error` instead of paging forever.
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
- **Round 0 is the genesis round here.** In query `rounds` (and simulate's `round`), 0 means the latest round.
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

`DTAlgodClient.simulateTransactions(request)` accepts a stock `SimulateRequest` or a `dtModels.DTSimulateRequest`, and sends it as algosdk would, with several groups allowed. Simulate is upstream's otherwise: dt-algorand dt5 removed the fork's simulate options (`rounds`, `parallelGroups`, the validity window modes and `protocol`), which `query()` replaced. For read-only calls at several rounds, each run alone, or under a later protocol, use [Query](#query).

`round` may be any round since genesis on a time-travel node; a node without time travel can only simulate its last few rounds. Simulating at round R evaluates the transactions as if in block R + 1, so they need `firstValid <= R + 1 <= lastValid`.

### Several groups

`txnGroups` may hold several groups, up to the node's `MaxAPISimulateGroups` (default 16, `simulate.maxTxnGroups` in the capabilities). They run in order as consecutive groups of one simulated block:

- each group sees the effects of the groups before it;
- a transaction or lease used by an earlier group is a duplicate;
- the groups share the block's byte limit, so a group that does not fit fails while a smaller later group may still fit;
- a group that fails is rolled back and later groups still run, except after a failed post-evaluation check (placeholder PQ signatures with `fixSigners`) or a corrupted evaluator, after which every later group is reported as not simulated;
- each group's failure is in its own `failureMessage` / `failedAt` (0-based), and `extraOpcodeBudget` applies to each group.

`simulateRawTransactions` takes one signed transaction, one group, or several groups (`Uint8Array[][]`).

`DTSimulateRequest.fromTransactions(groups, fields)` builds a request from unsigned transactions, one array per group, such as `TransactionComposer.buildTransactions()` output. It sends empty signatures, defaults `allowEmptySignatures` to true, and assigns a group ID to a multi-transaction group that has none (it never recomputes one, so build new transactions for each request).

```typescript
const request = algosdk.dtModels.DTSimulateRequest.fromTransactions(
  [group1Txns, group2Txns],
  { allowUnnamedResources: true, round: 45_000_000 }
);
const res = await algod.simulateTransactions(request).do();
```

### Reading results

`DTSimulateResponse` adds:

- `groupResult(groupIndex)`: one group, as `{ ok: true, result }` or `{ ok: false, error }`;
- `groupResults(groupCount?)`: every group's outcome, in request order. It defaults to the number of groups the request had (`requestGroupCount`, set by `simulateTransactions().do()`).

The `error` is a `SimulateGroupError` with `kind`:

- `group`: the group failed (`failureMessage`, and `failedAt` when the node blamed one transaction);
- `not-simulated`: the group was skipped after an earlier group failed a post-evaluation check;
- `missing`: the response has no result for the group.

It also has `groupIndex`, `round` (the response's `lastRound`), and, for `group` and `not-simulated`, `result` with the transactions that ran before the failure.

```typescript
for (const outcome of res.groupResults()) {
  if (outcome.ok) {
    console.log(
      outcome.groupIndex,
      outcome.result.txnResults[0].txnResult.logs
    );
  } else {
    console.log(outcome.groupIndex, outcome.error.kind, outcome.error.message);
  }
}
```

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
- `protocolOverride`: how the protocol applied (wire key `protocol`), set when another protocol than the round's own ran: `from`, `to`, `applied` (false when `from` already is `to`) and `notes`, where the run differs from what the chain recorded. Note codes are `semantics-changed`, `no-heartbeat-challenges`, `no-load-history`, `block-incentive-fields`, `block-hash-fields`, `online-stake-includes-expired`, `account-incentive-fields` and `app-version-starts-at-upgrade`; a note's `hits` name the calls (`group`, the call's index) and inner transactions (`path`) that read the data.

The client checks that the response has one entry per round, for the round asked for, and one result per call, and throws an `Error` otherwise. `doRaw()` returns the msgpack body unchecked.

### Streamed answers

`.stream(onEvent)` runs the query with the answer streamed: the node sends each call's logs as the called app makes them, as Server-Sent Events, and `onEvent` gets each one as it arrives. The promise resolves to the same `QueryResponse` as `do()`, with the same checks, once the stream ends. So a page can show a call's results while the other calls still run, and still use the full response at the end.

```typescript
const response = await algod
  .query({ program, calls })
  .rounds([r1, r2])
  .stream((event) => {
    if (event.type === 'logs')
      render(event.round, event.call, event.index, event.logs);
    if (event.type === 'round' && event.error) discard(event.round);
  });
```

| Event   | Fields                                             | When                                                                                                             |
| ------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `start` | `lastRound`, `rounds`                              | first: the round of each entry of `rounds`, 0 resolved                                                           |
| `logs`  | `round`, `call`, `index`, `logs`                   | as the called app logs; `index` is the first log's index in the call, and a call's logs come in order, each once |
| `call`  | `round`, `call`, `logs` (a count), `cost`, `error` | when a call ends, after its logs                                                                                 |
| `round` | `round`, `protocolOverride`, `error`               | when every call of a round ended; with an `error` the round has no results, so drop what came for its calls      |
| `end`   | `effort`, `error`, `status`                        | last; `effort` is the `X-Algod-Effort` value                                                                     |

Each distinct round comes once, however many entries of `rounds` it has. Events of different calls interleave, across rounds too, and `round` events come in the order the rounds end, not the order of `rounds`; a call's events come in order.

- **Nodes and clients that can't stream.** The node streams when its `capabilities().query.stream` lists `"sse"`. A node that doesn't answers in full (the request asks for `text/event-stream`, then msgpack), and so does an HTTP client without `postStream` (a wallet's `BaseHTTPClient`). `onEvent` then gets the events the stream would have had, all at once, before the promise resolves: code written for the stream works on every node. `HTTPClient.canStream()` tells whether a client streams.
- **Errors.** Errors before the stream starts are thrown as by `do()`: an invalid request, a busy node (503), queries disabled (`DTUnsupportedError`). The HTTP client's retries apply only to them, never once the body has started. A stream that ends early rejects with a `QueryStreamError`: `status` is what a full answer would have had (400 over `maxResponseBytes`, which `isQueryResponseTooLarge` recognizes, 504 at the time limit, 500), or `truncated` is true when the connection dropped before the `end` event. The events before it are what the calls did up to then: split the request and send it again as for `do()`, skipping the logs already shown, since a call makes the same logs at the same round.
- **Limits.** A stream counts each log once toward `maxResponseBytes`, as it is sent: a round listed twice counts once.
- **Stopping.** An exception `onEvent` throws closes the connection and rejects the promise with it; so does aborting a `signal` in `customOptions` (`.stream(onEvent, undefined, { signal })`). The node stops the calls when the connection closes.
- **HTTP clients.** `postStream(relativePath, data, query, headers, customOptions)` is an optional `BaseHTTPClient` method that resolves once the headers are in, with the body as a `ReadableStream`. `URLTokenBaseHTTPClient` has it, and `RetryingHTTPClient` has it when the client it wraps does.

### Differences from simulate

Code that falls back from query to simulate (or back) must handle these:

- **Protocol**: query runs under `latest` by default, so a past round runs today's rules and reports a `protocolOverride` with `applied` true and notes; simulate always runs the round's own protocol. Pass `.protocol('round')` to query for the chain's own rules.
- **Budget**: a query call gets at most `maxCallBudget` (320,000 by default), while a simulate group can get `simulate.maxExtraOpcodeBudget` plus the budget of its transactions. Compare a call's needs with `maxCallBudget` before choosing query.
- **Errors**: a query call's `error` is the bare evaluation error (`logic eval error: ...`); simulate's `failureMessage` is prefixed (`transaction N: ...`).
- **Logs**: query returns only the called app's logs, with no inner transaction or state echo. `maxCallLogBytes` can raise the log limit per program above the protocol's 1024 bytes in 32 logs.

### Limits and errors

`(await algod.capabilities()).query` has the node's `QueryLimits`, or is undefined when the node has queries disabled (or is stock algod):

- `maxCalls` calls and `maxRounds` round entries (duplicates included) per request;
- `maxTotalCalls`, the most calls times round entries per request (no `rounds` counts as 1): 1,024 by default, so 1,024 calls at one round, or 64 calls at 16 rounds. Older nodes don't report it, and it is `maxCalls * maxRounds` for them;
- `maxCallBudget`, the most (and default) budget per call;
- `maxCallLogBytes`, the most bytes each program of a call may log, in up to 2048 logs (0 for the protocol's limits);
- `maxResponseBytes`, the most bytes of logs and errors a request may return (0 for no limit). Each log counts `QUERY_LOG_OVERHEAD_BYTES` (48) more than its length, and a round listed twice counts twice.
- `stream`, the streamed answers the node offers: `["sse"]` when it streams logs as the calls make them ([Streamed answers](#streamed-answers)), empty on nodes that only answer in full.
- `maxSeekRounds`, the most rounds one call may move its reads to with the query-only `tt_seek` opcode (each counts 4096 bytes toward `maxCallStateBytes`); 0 when the node runs no `tt_seek`.
- `maxCallScanBytes`, the most bytes of history the searches of one call (`tt_global_key_change`, `tt_local_key_change`, `tt_box_prefix_change`) may read in all, and `maxScanStepBytes`, the most one search may read before it returns status 4 and the round to resume from; 0 when the searches are off.
- `opcodes`, the time-travel opcodes the node runs in query programs (first byte 0xff): `tt_seek`, the `tt_*_change` lookups on a node that keeps history, and the searches when `maxCallScanBytes` is above 0; empty when it runs none. A program with one the node lacks fails with `illegal opcode 0xff`.

The request body may be at most `MAX_QUERY_REQUEST_BYTES` (1,000,000) bytes of msgpack (`encodeMsgpack(request).length`), a fixed limit of the node that `capabilities()` does not report. The client checks none of these.

- A node with queries disabled (`MaxAPIQueryCalls` 0: a 400 saying so) is thrown as a `DTUnsupportedError`.
- Results over `maxResponseBytes` fail with a 400 that `isQueryResponseTooLarge(err)` recognizes: split the request and retry.
- Other 400s (too many calls, rounds or calls in total, a round after the latest, an unknown protocol, a bad address) pass through.
- A busy node answers 503 with `Retry-After` (query shares simulate's limiter), and a request over `timeLimitSeconds` 504.

Detect query and fall back, splitting rounds by `maxRounds` (and `maxTotalCalls`), then calls by `maxCalls` and by `maxTotalCalls` over the request's rounds (the SDK ships no chunker). An empty `rounds` is one request at the latest round:

```typescript
const { query } = await algod.capabilities();
if (!query) {
  // simulate instead
} else {
  const results = [];
  const perRequest = Math.min(query.maxRounds, query.maxTotalCalls);
  const chunks = [];
  for (let r = 0; r < rounds.length; r += perRequest)
    chunks.push(rounds.slice(r, r + perRequest));
  if (!chunks.length) chunks.push([]); // no rounds: the latest, counted as 1
  for (const some of chunks) {
    const callsPer = Math.min(
      query.maxCalls,
      Math.floor(query.maxTotalCalls / Math.max(1, some.length))
    );
    for (let c = 0; c < calls.length; c += callsPer) {
      results.push(
        await algod
          .query({ program, calls: calls.slice(c, c + callsPer) })
          .rounds(some)
          // The chain's own rules: a program newer than an old round's
          // protocol then fails in every call's `error` at that round.
          .protocol('round')
          .do(undefined, { signal }) // abortable
      );
    }
  }
}
```

## Capabilities

`capabilities()` reads `GET /v2/capabilities` once per client and returns a frozen `CapabilitiesResponse`: the fork features the node has on, and the limits it places on simulate and query requests.

| Field              | Meaning                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeTravel`       | `EnableTimeTravel` is on                                                                                                                                                                       |
| `developerApi`     | `EnableDeveloperAPI` is on (`execTraceConfig`, protocol `future`)                                                                                                                              |
| `timeLimitSeconds` | how long the node works on a simulate, query, versions or delta request before a 504, 0 for no limit                                                                                           |
| `simulate`         | `SimulateLimits` of `POST /v2/transactions/simulate`, below                                                                                                                                    |
| `query`            | `QueryLimits` of `POST /v2/query` (`maxCalls`, `maxCallBudget`, `maxCallLogBytes`, `maxCallStateBytes`, `maxResponseBytes`, `maxRounds`, `maxTotalCalls`); undefined when queries are disabled |
| `reported`         | the node reported these; false for the fallback below                                                                                                                                          |

`simulate`:

| Field                  | Meaning                             |
| ---------------------- | ----------------------------------- |
| `maxTxnGroups`         | groups per request                  |
| `maxExtraOpcodeBudget` | most `extraOpcodeBudget`, per group |

dt5 nodes no longer report simulate's `max-rounds` and `resource-limit-multiplier`, and the client ignores them when a dt4 node sends them.

A 0 limit from the node means no limit. `simulate` and `query` are frozen too.

The client reads capabilities leniently, so a node with a key more or less than this client knows still answers `capabilities()`: unknown keys are ignored, and a missing key takes a safe default. The flags default to false and `timeLimitSeconds` to 0. `simulate` defaults to stock algod's limits (1 group, 320,000 extra budget). In `query`, `maxCalls` and `maxRounds` default to 1, `maxCallBudget` to 700, the byte limits to 0, and `maxTotalCalls` to `maxCalls * maxRounds`. A value of the wrong type still fails. dt-algosdk 3.9.0-dt.4.1.0.0 and earlier required every key, so they cannot read a dt5 node's capabilities, which lack `simulate.max-rounds`.

Every dtalgod node serves its capabilities, so stock algod is the only node without them (a 404): it gets stock algod's instead (`CapabilitiesResponse.stock()`), with `reported` false: no time travel, no queries, and one group per simulate request, so send one request per round with `round` set. `getCapabilities()` is the uncached request, which throws `DTUnsupportedError` on a 404. The endpoint replaces `GET /v2/transactions/simulate/limits` of earlier fork builds, which the client no longer reads.

## Busy, time limit and history errors

Helpers that take the error a request threw and say what kind of failure it is: an HTTP error from `HTTPClient` (with `status` and `response`), or one straight from a `BaseHTTPClient` such as `URLTokenBaseHTTPClient` (status on `response`, the node's message in the JSON body). They match the status and the node's message, not headers.

| Helper                      | Matches                                                                                                                                                                                                                                       | What to do                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `isNodeBusy(err)`           | 503 "the node is busy" (simulate, query, versions and deltas share a concurrency limit), or "every slot for re-evaluating old rounds is in use" (deltas of rounds older than the in-memory ones)                                              | retry after `retryAfterSeconds(err) ?? 1` seconds, or on another node                                                    |
| `isTooManyRequests(err)`    | 429: the node's limit on requests in flight (`RestConnectionsSoftLimit`, default 1024), or a proxy's rate limit. dtalgod's has an empty body and `Retry-After: 1`; stock algod's has no `Retry-After`                                         | retry after `retryAfterSeconds(err) ?? 1` seconds, or on another node                                                    |
| `retryAfterSeconds(err)`    | the `Retry-After` header, in seconds or as an HTTP date; undefined without one                                                                                                                                                                | a delay for the retry                                                                                                    |
| `isNetworkError(err)`       | no HTTP response: a network error code (`ECONNREFUSED`, `ECONNRESET`, ..., on the error or on Node fetch's `cause`), or a browser's failed fetch (`TypeError` "Failed to fetch" and the like). Not an abort, `AbortSignal.timeout()` included | retry, after a while if the connection was refused: above `RestConnectionsHardLimit` (2048) the node refuses connections |
| `isTimeLimitExceeded(err)`  | 504, the node's time limit (`RestWriteTimeoutSeconds`; `timeLimitSeconds` in `capabilities()`)                                                                                                                                                | split the request (fewer groups, calls, rounds, a smaller page); don't retry it                                          |
| `isRoundTooLarge(err)`      | 400 "one round of boxes is too large" (boxes versions with `rounds`) or "too many objects to merge" (account versions, or boxes versions with `rounds`)                                                                                       | narrow it: a box `prefix()`, fewer objects, or reads at that round                                                       |
| `isHistoryUnavailable(err)` | 503 "the box index is incomplete", "the asset holders index is not complete" or "the time travel history is not served"                                                                                                                       | fall back to reads at a round, another node or an indexer; retrying soon fails                                           |

A browser can read a 429 and its `Retry-After` only from a node that sends CORS headers with it, dtalgod v5.0.5-dt5 and later. From older nodes the browser gets a failed fetch, which `isNetworkError` matches.

## Retries

`Algodv2`, `Indexer` and `DTAlgodClient` don't retry, as in algosdk. `withRetry` wraps their `BaseHTTPClient` in one that retries by the policy below, which dt-algokit-utils uses too:

```typescript
import {
  URLTokenBaseHTTPClient,
  withRetry,
  formatRetryWait,
} from 'algosdk/client';

const http = withRetry(
  new URLTokenBaseHTTPClient({ 'X-Algo-API-Token': token }, server, port),
  {
    // tell users while a request waits
    onWait: (wait) => setStatus(formatRetryWait(wait)),
  }
);
// the server comes from the HTTP client: Algodv2's types still ask for one
const algod = new algosdk.Algodv2(http, '');
const dt = new algosdk.DTAlgodClient(http, '');
```

### The policy

A failed request is decided in this order:

| #   | Error                                                                                                | Decision                                                                       |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | the request was aborted (`signal` in the request's fetch options)                                    | give up (`aborted`)                                                            |
| 2   | 503 history unavailable (`isHistoryUnavailable`)                                                     | give up (`history-unavailable`)                                                |
| 3   | 504 from a request under the node's time limit (`isTimeLimitedRequest`)                              | give up (`time-limit`): split or narrow it                                     |
| 4   | a status not in `retryStatuses` (408, 429, 500, 502, 503, 504), or an error that is no network error | give up (`not-retryable`)                                                      |
| 5   | a transaction submit (`isNonIdempotentRequest`) that the node may have taken                         | give up (`not-idempotent`)                                                     |
| 6   | `maxTries` tries made (5)                                                                            | give up (`max-tries`)                                                          |
| 7   | `Retry-After` above `maxRetryAfterMs` (30 s)                                                         | give up (`retry-after-too-long`)                                               |
| 8   | otherwise                                                                                            | retry: `rate-limited` (429), `node-busy` (busy 503), `server-error`, `network` |

The requests under the node's time limit are `POST /v2/query`, `POST /v2/transactions/simulate`, `GET /v2/deltas/{round}`, and `GET` of a `/v2/…/versions` or `/v2/…/holders` listing (not algod's own `GET /versions`): a retry would repeat all the work and run into the limit again.

A transaction submit (`POST /v2/transactions` and `/v2/transactions/async`) is retried only when the node surely did not take it: a 429, a busy 503, or a connection refused or never made (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ENETUNREACH`, `EHOSTUNREACH`, `UND_ERR_CONNECT_TIMEOUT`). After a lost answer (a reset connection, a 502, a browser's failed fetch), a retry would get "transaction already in ledger" instead of the transaction ID: check for the transaction instead.

The wait before a retry is the longest of:

- the backoff: 0 before the first retry, then 2, 4, 8 s, at most `maxBackoffMs` (10 s);
- the node's `Retry-After`, read on 429s and 503s only, up to `maxRetryAfterMs` (30 s);
- `busyMinDelayMs` (1 s) for a 429 or a busy 503 without `Retry-After` (or with `Retry-After: 0`), a refused connection (`ECONNREFUSED`), or a browser's failed fetch (which may be a 429 the browser couldn't read).

An abort ends a wait at once, rejecting with the signal's reason. When it gives up, the request throws the error of the last try itself, so `instanceof`, `status` and `response` work as without retries.

### Changing it

The second argument of `withRetry` is a `RetryOptions`: the `RetryPolicy` fields to change, or `false` for no retries. Fields left out, or undefined, keep their defaults (`DEFAULT_RETRY_POLICY`); lists replace the default lists.

| Field                               | Default                       | Meaning                                                                                                                     |
| ----------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `maxTries`                          | 5                             | tries in all, the first included; 1 turns retries off. Not even `decide` retries past it                                    |
| `maxBackoffMs`                      | 10,000                        | the longest backoff                                                                                                         |
| `maxRetryAfterMs`                   | 30,000                        | the longest `Retry-After` honoured; a longer one gives up at once                                                           |
| `busyMinDelayMs`                    | 1,000                         | the least wait for a 429 or a busy 503 without `Retry-After` (or with 0), a refused connection, or a browser's failed fetch |
| `backoffMs(retry)`                  | 0, 2, 4, 8 s, ...             | the backoff before retry `retry` (from 1), before `maxBackoffMs` caps it                                                    |
| `retryStatuses`                     | 408, 429, 500, 502, 503, 504  | the statuses that may be retried                                                                                            |
| `networkCodes`                      | `DEFAULT_NETWORK_ERROR_CODES` | the network error codes that may be retried                                                                                 |
| `decide(err, ctx, defaultDecision)` |                               | returns the decision to follow instead of the policy's own, within `maxTries`; an exception it throws is thrown             |
| `onWait(wait)`                      |                               | called before every retry; see below                                                                                        |
| `sleep(ms, signal)`                 | `sleepUnlessAborted`          | how to wait                                                                                                                 |

`retryDecision(err, { method, path, tries }, options)` gives the decision for one error, and `callWithRetry(send, { method, path, signal }, options)` runs any request under the policy.

### Telling users

`onWait(wait)` is called before every retry, those with no wait included, with a `RetryWait`:

- `reason`: `rate-limited`, `node-busy`, `server-error` or `network`;
- `delayMs`, and `until` (epoch milliseconds);
- `retryAfterMs`, when the node sent `Retry-After`;
- `retry` (from 1) and `maxRetries`;
- `method`, `path`, `status` (unless there was no response) and `error`.

`formatRetryWait(wait)` makes a message of it, such as "The node is rate limiting requests: retrying in 1 s (retry 1 of 4)". The wait is frozen and, when it waits (`delayMs > 0`), already in the client's `waits` (below) when `onWait` runs. An exception `onWait` throws, or a promise it rejects, is ignored.

To poll instead, make the client with `new RetryingHTTPClient(inner, options)`: it has `waits`, the requests waiting now, one each, and `waiting`, the one that waits longest. `withRetry` is typed as a plain `BaseHTTPClient`, since it returns a client that already retries as it is.

`withRetry` returns a client that already retries as it is, so requests are not retried twice over: such clients carry `RETRYING_CLIENT` (`Symbol.for('dt-algosdk.retrying-client')`), as dt-algokit-utils' does.

## Response headers

`doWithHeaders()` runs any request as `do()` does, with the same checks, and returns `{ data, headers }`, the headers keyed by lowercased name. An HTTP error has them too, in `err.response.headers`.

A dt-algorand node with `EnableEffortHeader` reports the work each request did in `X-Algod-Effort`, an RFC 9651 dictionary (`opcodes=700, lookups=3, history=2, scanned=10, response-bytes=512, eval-us=840`). `effortOf(headers)` parses it into an `Effort` (`opcodes`, `lookups`, `history`, `scanned`, `responseBytes`, `evalMicroseconds`), or gives undefined when it is absent or malformed (`parseEffortHeader(value)` takes the value itself). A field is undefined when the header leaves its key out. It is off by default and meant for a load balancer that bills on it and strips it, so most clients never see it: use it for diagnostics only.

```typescript
const { data, headers } = await algod
  .getApplicationVersions(1234)
  .doWithHeaders();
console.log(data.versions.length, algosdk.effortOf(headers)?.lookups);
```

A read at a round answers with `X-Algod-TT-Round` (`TT_ROUND_HEADER`), the round it was answered as of, which the client checks (see [Reads at past rounds](#reads-at-past-rounds)).

dt-algorand lists `Retry-After`, `X-Algod-Effort` and `X-Algod-TT-Round` in `Access-Control-Expose-Headers`, so browsers can read them on a cross-origin request. A proxy in front of the node may still drop them, so have a default for `retryAfterSeconds`.

## Optional node features

dt-algosdk covers the API of the current dt-algorand release. Every dt-algorand node has the capabilities endpoint, several groups per simulate request and the query endpoint; the rest depends on its config. `capabilities()` reads it once per client, and only the asset holders index needs a probe of its own:

| Feature                                                                 | Node config                                                                                                                                                   | How to tell                                                                                 | When off                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Time travel: reads at past rounds, `...Versions`, simulate at any round | `EnableTimeTravel`                                                                                                                                            | `supportsDT()` (`timeTravel` of the capabilities)                                           | `DTUnsupportedError` (the `/versions` and holders routes 404, `round` is a 400)  |
| Asset holders                                                           | `TimeTravelHoldersIndex` (and time travel)                                                                                                                    | `supportsAssetHolders()`, one probe that reads nothing, cached                              | `DTUnsupportedError`; an index not built yet is a 503 for `isHistoryUnavailable` |
| Query                                                                   | `MaxAPIQueryCalls` above 0                                                                                                                                    | `query` of the capabilities                                                                 | `DTUnsupportedError`                                                             |
| Query streaming                                                         | none: every node with query on, from the release with streams                                                                                                 | `stream` of the query limits lists `"sse"`                                                  | `stream()` gets the full answer and replays its events                           |
| Time-travel opcodes in query programs                                   | `MaxAPIQuerySeekRounds` above 0 for `tt_seek`; also `EnableTimeTravel` for the `tt_*_change` lookups, and `MaxAPIQueryCallScanBytes` above 0 for the searches | `opcodes` of the query limits (and `maxSeekRounds`, `maxCallScanBytes`, `maxScanStepBytes`) | `opcodes` lacks it; a program using it fails with `illegal opcode 0xff`          |
| Several groups per simulate request                                     | `MaxAPISimulateGroups` above 1                                                                                                                                | `simulate.maxTxnGroups` of the capabilities                                                 | the node's 400 `too many transaction groups`                                     |
| Execution traces, protocol `future`                                     | `EnableDeveloperAPI`                                                                                                                                          | `developerApi` of the capabilities                                                          | the node's 400                                                                   |
| `X-Algod-Effort`                                                        | `EnableEffortHeader`                                                                                                                                          | the header is present                                                                       | `effortOf(headers)` is undefined                                                 |

Against stock algod, `DTAlgodClient` works for everything inherited from `AlgodClient`. `capabilities()` falls back to stock algod's (`reported` false), so `supportsDT()` and `supportsAssetHolders()` are false and `query` is undefined. Gate the additions on these: stock algod ignores `round` and answers with the latest state (a read at a round throws `DTUnsupportedError`, as the answer has no `X-Algod-TT-Round`), rejects several simulate groups with its own 400, and answers the fork's routes unevenly: `getAssetVersions`, `accountAssetVersions`, `accountApplicationVersions` and `getAssetHolders` get its router's 400 (`Invalid format for parameter asset-id` or `application-id`), thrown as the plain HTTP error, while the other `...Versions` methods get a 404, thrown as a `DTUnsupportedError` that says time travel is off.

## Bug fixes and changes to upstream code

- `ABIArrayDynamicType.decode` and `ABITupleType.decode` read the length prefix and offsets from the start of the underlying `ArrayBuffer` instead of the start of the `Uint8Array` passed in. Decoding a subarray (for example a value sliced out of a log or box) read the wrong bytes. They now read at the view's `byteOffset`, and a dynamic array shorter than its 2-byte length prefix throws a clear error.

- `URLTokenBaseHTTPClient` built the `headers` of responses and HTTP errors with names and values swapped (`{ "1": "retry-after" }`), because `Headers.forEach` passes the value first. They are now keyed by the lowercased header name (`{ "retry-after": "1" }`), so retry logic can read `Retry-After` from a 503.

- `base64ToBytes` and `bytesToBase64` without Node's `Buffer` (browsers) built the bytes with `Uint8Array.from` and a callback, and the string one `String.fromCodePoint` per byte. They now use a `charCodeAt` loop and `String.fromCharCode` over 32 KB chunks: for 32 KB, 0.13 ms instead of 3.6 ms to decode and 0.29 ms instead of 2.3 ms to encode. Every box value, program, state key and `changedKeys` entry decoded in a browser goes through them. Node keeps using `Buffer`.

- `JSONRequest` gains `doWithHeaders()`, which returns the decoded data and the response headers (lowercased names). It runs `executeRequest` then `prepare`, so every subclass's checks apply as in `do()`.

- `Address.fromString` keeps the public keys of the last 10,000 address strings whose checksum it checked, so a string seen again skips the base32 decode and the SHA-512/256 checksum (it returns a new `Address` with its own copy of the key). Simulate responses repeat the same unnamed accounts in every group, and responses at several rounds repeat them again: decoding the unnamed resources of 16 groups at each of 16 rounds over 16 accounts takes 4.6 ms instead of 25 ms.
- `Address.toString` (and so `encodeAddress` and the ABI `address` decode) keeps the strings of the last 10,000 public keys it encoded, keyed by the key's bytes, so a key seen again skips the SHA-512/256 checksum and the base32 encode. Decoding ABI addresses from the logs of a read at many rounds encodes the same keys in every round: 2,000 keys × 64 rounds take about 30–55 ms instead of 450–560 ms.

## Releasing dt-algosdk

GitHub Actions publishes dt-algosdk, with [`.github/workflows/dtalgosdk.yml`](.github/workflows/dtalgosdk.yml). On every push and pull request to `dtalgorand` it runs the linters, the type checks and the tests. On a `v<version>` tag it also checks the release, publishes it to npm with provenance, and creates a GitHub release with the package tarball and the browser bundle. Upstream's workflows that release or open pull requests (`release.yml`, `prod_release.yml`, `codegen.yml`) run only on algorand/js-algorand-sdk.

1. Choose the version, `<algosdk version>-dt.<dt-algorand release>.<SDK release>`:
   - the algosdk version the code is built on; change it when merging a new upstream release;
   - the number of the latest dt-algorand release (`v5.0.4-dt2` is 2) whose API the SDK covers. Nodes of older dt-algorand releases are not supported; the client detects only the optional features of the current release (see [Optional node features](#optional-node-features)). Keep the dot (`dt.2`, not `dt2`), so that npm compares it as a number and `dt.10` sorts after `dt.9`;
   - the SDK's own release, `x.y.z`: bump `x` for a breaking change to the fork's API, `y` for features and `z` for fixes. It never starts again: when the algosdk version or the dt-algorand release changes, it keeps counting from the last release, bumped as the change calls for.
2. Set it and update the docs: `npm version <version> --no-git-tag-version`, `npm run build`, then `node scripts/ci/dtalgosdk-release.js update`. The script sets the version in the install snippets and CDN URLs in `README.md` and in this file, and the browser bundle's `integrity` hash in `README.md`.
3. `npm test`, then `npm pack --dry-run` to check the contents (`dist/`, `src/`, `README.md`, `DTALGOSDK.md`, `LICENSE`).
4. Commit and push `dtalgorand`, then tag the commit and push the tag: `git tag v<version>` and `git push d13co v<version>`.
5. The workflow checks that the tag is on `dtalgorand` and matches the version in `package.json` and `package-lock.json`, and that the docs name that version and the bundle's hash (`node scripts/ci/dtalgosdk-release.js check v<version>` runs the same check locally). It then runs the tests and publishes with `npm publish --tag latest`: npm 11 publishes a prerelease only with an explicit tag, and `latest` makes it the version `npm install dt-algosdk` gets. If the version is already on npm, the workflow does not publish it again and only creates the GitHub release.

### One-time setup

- **Default branch.** Set it to `dtalgorand` (Settings → General). The guards that keep upstream's workflows off the fork exist only on this branch, and GitHub runs scheduled workflows such as `codegen.yml` from the default branch. It also makes the repository page show this branch's README.
- **First version, by hand.** The workflow publishes only through npm trusted publishing, which is set up on a package that already exists. Publish the first version from a checkout: steps 1 to 3, then `npm publish --tag latest`, then push the tag (step 4). The workflow sees that the version is on npm, skips publishing, and creates the GitHub release.
- **Trusted publisher.** Right after the first publish, add one for the workflow, either in the package's settings on npmjs.com (Trusted publishing → GitHub Actions: owner `d13co`, repository `dt-js-algorand-sdk`, workflow `dtalgosdk.yml`, environment `npm`, publishing allowed) or with npm 11.5.1 or later: `npm trust github dt-algosdk --file dtalgosdk.yml --repo d13co/dt-js-algorand-sdk --env npm --allow-publish`. Publishing is not allowed unless it is turned on. npm drops a new trusted publisher if nothing is published with it within 2 days, so set it up when the next release is close, or add it again later. Trusted publishing adds provenance to each version, and needs no token.
- **Approval (optional).** The publish job runs in the GitHub environment `npm`, which GitHub creates on the first run. To approve each release by hand, add required reviewers to it under Settings → Environments.
