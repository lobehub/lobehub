# Security rule calibration

These are lint-rule calibration results, not a product security audit or confirmation
that an endpoint is exploitable. All twelve rules start at `warn`.

## Fixtures

Fixtures are inert source-text inputs. They are never executed as application code.
Final cold calibration on 2026-09-29 passed all **94 fixtures**: **79 new security
fixtures** (30 unsafe, 49 safe) plus 15 existing fixtures. Including the real Logto
validator and handler, this run completed 118 rule executions with **zero execution
failures** and no diagnostics on either real auth file.

After rebasing onto the updated `canary` rule set, the complete fixture suite
passed **117 cases**, including the upstream browser and package-layer fixtures.

Every bad fixture specifies the expected diagnostic line with `// alint-expect`;
every good fixture must produce zero findings. Config groups isolate each fixture
from unrelated rules. The normal fixture suite automatically discovers all files.

| Rule                               | Unsafe examples | Safe examples |
| ---------------------------------- | --------------- | ------------- |
| `no-auth-verification-bypass`      | 3               | 6             |
| `no-privileged-untrusted-electron` | 2               | 2             |
| `no-prototype-pollution`           | 2               | 4             |
| `no-secret-exposure`               | 3               | 4             |
| `no-shell-command-injection`       | 3               | 7             |
| `no-unsafe-html-execution`         | 3               | 3             |
| `no-unsafe-raw-sql`                | 2               | 2             |
| `no-unsafe-user-url-fetch`         | 2               | 5             |
| `no-unscoped-resource-mutation`    | 2               | 7             |
| `no-untrusted-code-execution`      | 3               | 2             |
| `no-untrusted-path-io`             | 3               | 5             |
| `no-unvalidated-redirect`          | 2               | 2             |

Safe cases exercise actual boundaries: shell argv/escaping/encoding, authorized
terminals and remote sandboxes, HTML sanitization and sandboxed origins,
parameterized SQL, verified authentication, redacted credentials, exact redirect
origins, null-prototype records and approved filesystem access.

## Real source sampling

The initial expanded cold scan covered 37 files and completed 255 rule executions
with no execution failures. Four files were rechecked cold (40 executions) after
refining the shell, SSRF, auth and credential rules. The CLI bot command was also
checked cold (two executions). The final auth refinement additionally checks the
real Logto validator and its consuming handler.

Observed calibration corrections:

- Remote sandbox commands are not host SSRF requests or accidental shell injection.
  Server-generated paths, correct POSIX escaping and base64 data are not unsafe
  shell syntax. No findings remained on the Onlyboxes provider in the recheck.
- A JWT claims object is not automatically a credential, and a secret in scope
  does not prove an opaque exception contains that secret. No credential warnings
  remained on the OIDC helper in the recheck. Explicit credential-bearing error
  messages remain reportable; parser/library error leakage requires separate review.
- Optional administrator-configured header policies are distinct from mandatory
  signed-event verification. No warning remained on the optional memory webhook
  header guard in the recheck.
- A verifier returning undefined is a failure result. The Logto handler explicitly
  rejects that result before processing events. The auth rule now demands one of
  three visible acceptance/side-effect bypasses and has a matching HMAC fixture.

Three path-confinement warnings on desktop `fileSrv` (upload/read/delete) remain
candidates for separate caller/reachability investigation. They are not confirmed
endpoint vulnerabilities and this change does not alter their implementation.
Earlier calibration of the original three rules also varied on knowledge-base
and group relation checks; a group-copy warning was a false positive despite its
small fixture passing. Large-file and cross-file reasoning remain limitations.

Additional scope limits are intentional: dependency vulnerabilities, configuration
policy decisions, arbitrary custom interpreters and full cross-file authorization
proof need other checks/review. Do not treat a clean ALint run as a security proof.

### Sample manifest

```text
apps/server/src/services/skill/importer.ts
apps/server/src/services/generation/index.ts
apps/server/src/utils/tempFileManager.ts
packages/database/src/models/knowledgeBase.ts
packages/database/src/repositories/agentGroup/index.ts
packages/database/src/models/agentBotProvider.ts
packages/database/src/models/agentCronJob.ts
apps/desktop/src/main/services/fileSrv.ts
packages/local-file-shell/src/shell/runner.ts
packages/local-file-shell/src/git/info.ts
packages/local-file-shell/src/git/pullRequest.ts
packages/local-file-shell/src/file/grep.ts
packages/heterogeneous-agents/src/spawn/devinAcpSession.ts
apps/desktop/src/main/utils/heteroCliProcess.ts
apps/desktop/src/main/utils/heteroExecProcess.ts
apps/server/src/services/sandbox/providers/onlyboxes.ts
apps/server/src/services/sandbox/index.ts
packages/utils/src/client/sanitize.ts
apps/server/src/utils/serializeForHtml.ts
src/features/Portal/Artifacts/Body/Renderer/SVG.tsx
packages/database/src/repositories/ftsSearch/pgSearch/index.ts
packages/database/src/repositories/ftsSearch/pgLike/index.ts
packages/database/src/repositories/ftsSearch/elasticsearch/query-fields.ts
apps/server/src/services/bot/credentialMasking.ts
apps/server/src/routers/lambda/agentBotProvider.ts
apps/server/src/router-hono/webhooks/handlers/github.ts
apps/server/src/router-hono/webhooks/handlers/logtoValidateRequest.ts
apps/server/src/router-hono/webhooks/handlers/casdoorValidateRequest.ts
apps/server/src/router-hono/webhooks/middlewares/memoryWebhookAuth.ts
src/libs/oidc-provider/jwt.ts
apps/server/src/router-hono/agent/handlers/messengerOAuthCallback.ts
apps/server/src/router-hono/webhooks/handlers/githubSetup.ts
src/features/Settings/oauth-apps/redirectUris.ts
apps/desktop/src/main/core/browser/Browser.ts
apps/desktop/src/preload/index.ts
apps/desktop/src/preload/invoke.ts
apps/desktop/src/main/controllers/ConnectorOAuthCtr.ts
apps/cli/src/commands/bot.ts
apps/server/src/router-hono/webhooks/handlers/logto.ts
```

## Reproduce

From the repository root:

```sh
bun run alint plugin install
cd packages/alint
bunx vitest run fixtures.test.ts --silent='passed-only'
```

For a cold run, pass the fixture/source paths to `bun run alint --no-cache --format json`.
Inspect `execution.failed` as well as diagnostics. Nonzero status from a source
sample can come from existing non-security error rules; it is not itself a model
execution failure. Review each security finding in context.

This is tooling-only: no product behavior changed, so no product acceptance run is
required. Lint and model-backed fixture calibration are the relevant checks.
