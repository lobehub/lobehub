# Test value calibration

Both rules run at `warn` on test/spec files in `src`, `apps` and `packages`.
Fixtures and mocks are excluded from that scope; each calibration fixture meets
only its own rule. No product code is changed, so product acceptance is not required.

## Model and method

Calibration on 2026-10-10 used alint 0.7.3 and Claude Code's authenticated native
structured output, resolved to `claude-opus-5-5`. A temporary loopback
OpenAI-compatible provider passed alint's original system/user messages and
function schema to the CLI, then mapped the returned structured object to the
requested tool result. Built-in tools, other MCP servers and persisted CLI sessions
were disabled. The adapter and credentials are not part of this change.

Neither local nor global API providers were initially configured. Codex ACP calls
were rejected by the account; Claude ACP tool calls timed out. The successful
native structured-output transport supplied the actual model calibration below.
These results do not claim equivalent accuracy on the CI provider.

## Fixtures and real files

| Final cold run                 | Executions                           | Findings                 | Input / output tokens |
| ------------------------------ | ------------------------------------ | ------------------------ | --------------------- |
| New fixtures                   | 28, no cache hits, failures or skips | 7 expected, 0 unexpected | 72,020 / 4,063        |
| 32 real test files, both rules | 64, no cache hits, failures or skips | 0 after narrowing        | 755,426 / 8,020       |

The new fixtures contain four removal-only violations and three inert-stub
violations. Twenty-one good cases cover data deletion, security/isolation,
conditional and deployment-specific registration, custom validation, compatibility
conversion, meaningful error mapping/recovery and unknown imported implementations.
All expected findings match their `it`/`test` anchors; good cases produce none.

The real sample contains eight CLI, eight server, eight package and eight web test
files. Representative checks include `apps/cli/src/modelFacingDocs.test.ts`,
`apps/server/src/routers/lambda/__tests__/integration/project.integration.test.ts`,
`packages/database/src/models/__tests__/project.test.ts`,
`packages/heterogeneous-agents/src/runtimeBoundary.test.ts` and
`src/spa/router/desktopRouter.sync.test.tsx`.

The initial scan reported the router's visitor-route fallback test. Independent
classification treated this conservatively as a false positive: the same file
explicitly documents an ongoing registration/accounting boundary between the
base shell and a business deployment. The rule now excludes that visible policy
even when the test asserts only the unsupported side. A matching good fixture and
the final cold scan confirm that exemption without losing the seven true-positive
fixtures. Product tests were left unchanged.

The fixture sample is a design/calibration sample, so its apparent precision is
optimistic. Zero findings on the narrowed real sample cannot establish precision
or recall. Imported implementations remain a deliberate blind spot; promotion to
`error` requires separate real-PR evidence.

## Harness checks

Provider detection asks alint for its merged model configuration. Five tests cover
global-only, local-only, absent, empty and invalid setup. The previous local-file
existence check fails three of them; the fixed detector passes all five. No fake
provider or empty setup was used to bypass calibration.

A full cold scan of the initial 173-fixture tree completed every job without
failures or skips. The final suite passes 190 tests: 174 fixture cases, five
provider-detection tests and eleven reporting tests, with no skipped tests.
Unchanged rule results are reused by alint's content-and-rule cache. Targeted lint,
TOML parsing, plugin registration and TypeScript checks of the harness pass.
