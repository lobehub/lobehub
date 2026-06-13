# Auth Setup for Local Agent Testing

**Auth is the gate for all automated testing.** Prepare and verify it before
writing any test step. The one-stop entry point is:

```bash
SCRIPT=".agents/skills/agent-testing/scripts/setup-auth.sh"
TEST_ENV=".agents/skills/agent-testing/scripts/test-env.sh"

$TEST_ENV # print APP_URL/PORT/SERVER_URL/auth origins before testing
eval "$($TEST_ENV --exports)"
$SCRIPT status               # check server + CLI + web auth readiness
$SCRIPT status --surface web # check only the Web surface gate
$SCRIPT cli                  # interactive CLI device-code login (must be run by the user)
$SCRIPT open-chrome          # open Chrome at SERVER_URL and show DevTools Network
pbpaste | $SCRIPT web        # inject a copied Cookie header into the agent-browser session
$SCRIPT web-verify           # live-check that the agent-browser session is authenticated
```

`SERVER_URL` comes from `test-env.sh`: current shell env and `.env` files win;
worktree-name defaults are fallback only. Override it with the actual URL
printed by the running dev server before checking auth when needed:

```bash
eval "$(.agents/skills/agent-testing/scripts/test-env.sh --exports)"
$SCRIPT status --surface web
```

Use `localhost` for Web auth when possible; local better-auth cookies are stored
for the `localhost` domain, not `127.0.0.1`.

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

### One-key path

0. First verify the agent-browser session:

```bash
eval "$(./.agents/skills/agent-testing/scripts/test-env.sh --exports)"
./.agents/skills/agent-testing/scripts/setup-auth.sh status --surface web
```

If this is green, start testing. Do not ask for a Cookie header and do not open
a login page.

1. If verification fails, ask the user to copy the Cookie header **from a Network request, NOT
   `document.cookie`** (`document.cookie` cannot see HttpOnly cookies, which is
   exactly where better-auth puts its session):
   - First open Chrome and DevTools Network for the user:
     ```bash
     eval "$(./.agents/skills/agent-testing/scripts/test-env.sh --exports)"
     ./.agents/skills/agent-testing/scripts/setup-auth.sh open-chrome
     ```
   - If DevTools does not land on **Network**, click the **Network** tab manually.
   - Refresh → click any same-origin request.
   - Under **Request Headers**, right-click the `Cookie:` line → **Copy value**.
2. Inject and verify in one shot:

```bash
eval "$(./.agents/skills/agent-testing/scripts/test-env.sh --exports)"
pbpaste | ./.agents/skills/agent-testing/scripts/setup-auth.sh web
```

The script filters the header down to the better-auth cookies
(`better-auth.session_token`, `better-auth.session_data`, `better-auth.state`),
builds the Playwright `storageState` JSON, loads it into the `agent-browser`
session (default name `lobehub-dev`), opens `SERVER_URL`, and asserts the URL is
not `/signin`.

### Using the authenticated session

```bash
agent-browser --session lobehub-dev open "$SERVER_URL/"
agent-browser --session lobehub-dev snapshot -i | head -20
# Look for the user's avatar/name in the sidebar, or absence of the signin form.
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
