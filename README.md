# UltraCode for DeepSeek Harness

UltraCode is a deep-work mode for [DeepSeek Harness](https://github.com/deepseek-harness/deepseek-harness). While it is on, the harness optimizes for the most exhaustive, correct answer instead of the fastest or cheapest one: a substantive task is decomposed, its parts are delegated in parallel to models the deployment ranks, and the assembled result is verified before it is reported.

It is not a separate orchestration engine. The parallel fan-out belongs to the delegation operation the harness already has. What this plugin adds is the policy that makes delegation the default on a substantive turn, the model each role runs on, the durable record a browser reads, and the panel that shows the work.

Inspired by the `ultracode` mode in Claude Code, reimplemented for DSH.

## What it does

- **A session mode, logged not mirrored.** `/ultracode` toggles. State is folded from the session log, so resuming or forking a session restores the mode without a live copy.
- **Role routing.** The deployment ranks its models in a catalog. `maximum` sends every role to the best model. `frugal` runs the coder on the cheapest and the validator on the best, so a cheap model does the work and an expensive one judges it.
- **A reasoning ladder per route.** A route may name an effort rung. It is narrowed against the model's own adapter-declared ladder, so one catalog can describe models with different ladders without failing when a rung is missing.
- **Parallel delegation with verification.** `ultracode_delegate` runs one task as several concurrent members, or as a coder/validator loop in `frugal` mode. The validator answers through a required `{ passed, findings }` schema, so acceptance is a boolean the provider validated rather than prose the tool has to parse.
- **Vision handoff.** When the routed model cannot read images, an image-capable model describes them first and the child receives that description.
- **An orchestration panel.** Each task appears in the conversation with its members, their models, their status, a filter, and inline stop/collapse controls.

## Install

```sh
dsh plugin --profile <profile> add dsh-ultracode@github:JohnnyPBelo/dsh-ultracode
```

Then add the bundle to the profile's `dsh.profile.bundles` list. The package ships its own `cordis.patch.yml`, so the boot merges the plugin rows without further edits.

Restart the app after installing. A new client bundle reaches the browser only after a reload, and the host rows only after a restart.

`dsh` refuses to manage the `desktop` profile for any command — `profile "desktop" is managed exclusively by the Electron application` — so install it there through the application's own plugin manager rather than this CLI. A profile that installs a git-hosted plugin also needs pnpm's build permission for it: when pnpm prints `ERR_PNPM_IGNORED_BUILDS`, add the exact keys it names under `allowBuilds` in the profile's `pnpm-workspace.yaml` and re-run.

To try a build without touching a working profile, copy its `package.json`, `cordis.patch.yml`, and `pnpm-workspace.yaml` into a new profile directory and install there first. That reproduces the target's full bundle composition, which is the only way to see whether a new row activates among the rows already installed.

## Configuration

The bundle patch mounts the plugin with a working default. To change it, override the row in your profile's own `cordis.patch.yml` — an entry without `insert` overrides a row by id:

```yaml
- id: ultracode
  config:
    mode: maximum
    keyword: ultracode
    reminderEveryTurns: 10
    section: |
      UltraCode is on in {mode} mode: ... {routes} ...
    catalog:
      routes:
        - provider: deepseek-official
          model: deepseek-v4-pro
          effort: max
        - provider: deepseek-official
          model: deepseek-v4-flash
          effort: low
```

| Key | Meaning |
| --- | --- |
| `section` | Required. The guidance the model reads while the mode is on. `{mode}` and `{routes}` are replaced with the mode in force and the resolved route per role. |
| `catalog.routes` | Required, at least one. The deployment's ranking, best model first. UltraCode never invents an order. |
| `effort` | Optional per route. A rung on that model's adapter-declared ladder. A model without that rung runs at its default instead of failing. |
| `roles` | Pins `coder`, `validator`, or `vision` to a route. A pin always wins over tier selection. |
| `mode` | The mode a session starts in. |
| `keyword` | A word that activates the mode from a human-typed prompt. Omit it to leave `/ultracode` as the only switch. |
| `reminderEveryTurns` | Cadence of the standing policy reminder, in the session's own turns. Zero sends none. |

The delegation tool has its own row:

```yaml
- id: tool-ultracode-delegate
  config:
    provider: spawn
    maxValidationRounds: 3
```

| Key | Default | Meaning |
| --- | --- | --- |
| `provider` | — | Required. The subagent provider (`spawn` or `fork`) every member runs on. |
| `maxValidationRounds` | `3` | Validator rejections a `frugal` run may take before reporting failure. |
| `maxTaskTokens` | unset | Provider-billed tokens one `frugal` task may spend, summed over every member. |

## Modes

`maximum` sends every role to the best catalog route and keeps the session's own loop there too, so the orchestrator and the work it delegates run at the same rung. Nothing is traded for cost.

`frugal` keeps the same decomposition and fan-out but runs the coder on the last catalog route and the validator on the first. The orchestrator stays at its adapter default, because the mode is defined by not paying for the top rung.

Both modes end in the same place: work is delegated, and the result is checked before it is reported.

## Tests

The suite runs against a real DeepSeek Harness runtime, not a mock: it imports the bundles, boots the client entry on a live Cordis root, and checks the manifest and bundle patch.

```sh
DSH_TEST_RUNTIMES="/opt/DeepSeek Harness/resources/dsh/node_modules" node tests/run.mjs
```

`DSH_TEST_RUNTIMES` is a `:`-separated list of `node_modules` directories, so one run can cover several installed harness versions.

One test exists because of a shipped defect. A client entry whose `inject` names a service the web shell does not provide stays `pending`, and `packages/client/web/src/boot.ts` treats any non-active entry as a failed web boot — so one stale service name takes down the whole application, not just this plugin. Version 1.0.0 declared `conversationEvents`, which 0.2.x renamed to `uiConversation.events`, and the app refused to boot. `tests/client.test.mjs` now boots the entry on a live root and fails if any service that differs between the two API lines is named in `inject`. Only `slots` and `locale` are required; every other service is resolved at the call site, where its absence degrades one feature instead of the boot.

## Requirements

- DeepSeek Harness with the `dsh.profile.bundles` mechanism.
- A subagent provider named `spawn` (shipped with DSH as `dsh-subagent-spawn-in-process`).
- For `frugal` mode over one long-lived coder, session persistence plus the `agents` service. Both are on the standard bundle. Without them the loop still runs, one fresh child per round.

## Layout

| Path | What it is |
| --- | --- |
| `lib/host.js` | The mode, routing, effort, vision handoff, projection, and `/ultracode` command. |
| `lib/delegate.js` | The `ultracode_delegate` tool. |
| `lib/host-invariant.js`, `lib/delegate-invariant.js` | Durable-log invariants for each half. |
| `client/client.js` | The browser bundle: the orchestration panel, filter, collapse action, and task renderer. |
| `cordis.patch.yml` | The bundle layer that mounts both halves. |

## Licence

MIT.
