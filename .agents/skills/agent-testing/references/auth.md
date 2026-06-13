# Auth Setup for Local Agent Testing

**Auth is the gate for all automated testing.** Complete
[Step 0.0](../SKILL.md#00-resolve-the-current-test-environment) first so
`SERVER_URL` and ports are resolved, then verify auth before writing any test
step.

Initialize helpers first:

```bash
SCRIPT="./.agents/skills/agent-testing/scripts/setup-auth.sh"
TEST_ENV="./.agents/skills/agent-testing/scripts/test-env.sh"
eval "$($TEST_ENV --exports)"
```

Quick reference after initialization:

| Command                        | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `$SCRIPT status`               | Check all surfaces (server + CLI + web + Electron) |
| `$SCRIPT status --surface web` | Check only the Web surface gate                    |
| `$SCRIPT cli`                  | Interactive CLI device-code login (user must run)  |
| `$SCRIPT open-chrome`          | Open Chrome at `SERVER_URL` with DevTools          |
| `pbpaste \| $SCRIPT web`       | Inject a copied Cookie header into agent-browser   |
| `$SCRIPT web-verify`           | Live-check agent-browser session auth              |

Use `localhost` for Web auth; better-auth cookies are stored for `localhost`,
not `127.0.0.1`.

## Per-surface overview

| Surface  | Mechanism                                | Persistence                                                       | Human interaction                               |
| -------- | ---------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| CLI      | OIDC Device Code Flow                    | `apps/cli/.lobehub-dev/settings.json`                             | Yes — browser authorization, every token expiry |
| Web      | better-auth cookie injection             | `~/.lobehub-agent-testing/web-state.json` + agent-browser session | Copy the Cookie header once per token rotation  |
| Electron | App's own login state                    | Electron user-data dir                                            | Log in once manually in the app                 |
| Bot      | Native apps (Discord/WeChat/…) logged in | Each app's own session                                            | Once per app                                    |

## CLI — Device Code Flow

Credentials are isolated from the user's real CLI config via
`LOBEHUB_CLI_HOME=.lobehub-dev` (kept inside `apps/cli/`, gitignored).

Login requires interactive browser authorization, so **the user must run it
themselves** (e.g. via the `!` prefix in Claude Code):

```bash
cd apps/cli && LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts login --server http://localhost:3010
```

- The `--server` flag is required — an env var does NOT work and login will hit
  the wrong server without it.
- Check state without logging in: `setup-auth.sh status` (verifies
  `settings.json` exists and `serverUrl` matches).
- `UNAUTHORIZED` on API calls means the token expired — re-run login.

## Web — better-auth cookie injection (agent-browser)

The Web test surface is `agent-browser --session lobehub-dev`. The user's
ordinary Chrome is only a cookie source; Chrome screenshots, Chrome Network
records, and Chrome logged-in state do not prove the agent-browser test session
is authenticated.

`agent-browser --headed` on macOS often creates the Chromium window off-screen —
the user can't see or interact with it, so manual login inside the agent-browser
session fails. Instead, copy the **better-auth session cookie** out of the
user's own logged-in Chrome and inject it as a Playwright-style state file.

Do **not** use this on production URLs — only local dev. Treat the cookie as a
secret: don't paste it into shared logs, PRs, or commit it anywhere.

### Web — decision flow

1. `$SCRIPT status --surface web` — green? Start testing. Do not ask for a Cookie header.
2. Not green → `$SCRIPT open-chrome` opens Chrome at `SERVER_URL` with DevTools.
3. User copies the `Cookie:` header from Network tab → any same-origin request → Request Headers → right-click `Cookie:` → **Copy value**. Must be from Network, NOT `document.cookie` (HttpOnly cookies are invisible to `document.cookie`).
4. `pbpaste | $SCRIPT web` — filters to better-auth cookies (`session_token`, `session_data`, `state`), builds Playwright `storageState`, loads it into the `agent-browser` session (`lobehub-dev`), opens `SERVER_URL`, and asserts the URL is not `/signin`.

### Using the authenticated session

```bash
agent-browser --session lobehub-dev open "$SERVER_URL/"
agent-browser --session lobehub-dev snapshot -i | head -20
```

### Notes

- `storageState` doesn't enforce the HttpOnly flag on load — the script stores
  cookies with `httpOnly: false`, which is fine for local dev and sidesteps a
  CDP-context quirk where HttpOnly cookies sometimes fail to attach.
- The state file is kept at `~/.lobehub-agent-testing/web-state.json` so
  `setup-auth.sh status` can report web-auth readiness across sessions.

### Common failure modes

| Symptom                                       | Cause                                                                     | Fix                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Still redirects to `/signin` after injection  | User pasted from `document.cookie` → missed HttpOnly session              | Re-pull from Network request Headers, not console                                              |
| Script reports `no better-auth cookies found` | User pasted the wrong value, or the cookie parser regressed               | Keep the raw `Cookie:` header as-is; run `scripts/setup-auth.test.sh` if the input looks valid |
| Login works briefly then expires              | `better-auth.session_token` rotated (user logged out / signed in again)   | Re-copy and re-inject                                                                          |
| Domain mismatch                               | Cookie domain must be `localhost` literally, no leading dot for local dev | —                                                                                              |

## Electron

The desktop app keeps its own persistent login state in its user-data
directory — log in once manually inside the app and it survives restarts of
`electron-dev.sh`. No injection needed. The standard check (do NOT hand-roll a
store eval) once Electron is up with CDP:

```bash
./.agents/skills/agent-testing/scripts/app-probe.sh auth
# → {"ok":true,"isSignedIn":true,"userId":"user_xxx"}
```

`setup-auth.sh status` runs this probe automatically when CDP 9222 is
reachable.

## Scope

These recipes only cover **local dev** authentication. They do not:

- Work for production — production cookies are `Secure; HttpOnly; Domain=.lobehub.com`
  and must be delivered over HTTPS.
- Replace real OAuth flows — tests that must exercise the login UI itself need a
  real Chromium with `--remote-debugging-port` or a bot account.
- Flow cookies back to the user's Chrome — injection is one-way.
