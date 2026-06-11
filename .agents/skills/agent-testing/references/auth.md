# Auth Setup for Local Agent Testing

**Auth is the gate for all automated testing.** Prepare and verify it before
writing any test step. The one-stop entry point is:

```bash
SCRIPT=".agents/skills/agent-testing/scripts/setup-auth.sh"

$SCRIPT status        # check server + CLI + web auth readiness
$SCRIPT cli           # interactive CLI device-code login (must be run by the user)
pbpaste | $SCRIPT web # inject a copied Cookie header into the agent-browser session
$SCRIPT web-verify    # live-check that the agent-browser session is authenticated
```

`SERVER_URL` defaults to `http://localhost:3010` (this repo's `dev:next` port).
Override it when testing against another server (e.g. `SERVER_URL=http://localhost:3011`
in the cloud repo).

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

`agent-browser --headed` on macOS often creates the Chromium window off-screen —
the user can't see or interact with it, so manual login inside the agent-browser
session fails. Instead, copy the **better-auth session cookie** out of the
user's own logged-in Chrome and inject it as a Playwright-style state file.

Do **not** use this on production URLs — only local dev. Treat the cookie as a
secret: don't paste it into shared logs, PRs, or commit it anywhere.

### One-key path

1. Ask the user to copy the Cookie header **from a Network request, NOT
   `document.cookie`** (`document.cookie` cannot see HttpOnly cookies, which is
   exactly where better-auth puts its session):
   - Open the logged-in tab (`http://localhost:<port>/…`) in Chrome.
   - `Cmd+Option+I` → **Network** tab → refresh → click any same-origin request.
   - Under **Request Headers**, right-click the `Cookie:` line → **Copy value**.
2. Inject and verify in one shot:

```bash
pbpaste | ./.agents/skills/agent-testing/scripts/setup-auth.sh web
```

The script filters the header down to the better-auth cookies
(`better-auth.session_token`, `better-auth.state`), builds the Playwright
`storageState` JSON, loads it into the `agent-browser` session (default name
`lobehub-dev`), opens `SERVER_URL`, and asserts the URL is not `/signin`.

### Using the authenticated session

```bash
agent-browser --session lobehub-dev open "http://localhost:3010/"
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

| Symptom                                       | Cause                                                                     | Fix                                               |
| --------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| Still redirects to `/signin` after injection  | User pasted from `document.cookie` → missed HttpOnly session              | Re-pull from Network request Headers, not console |
| Script reports `no better-auth cookies found` | Separator wrong, or user pasted URL-decoded value                         | Keep the raw `Cookie:` header as-is               |
| Login works briefly then expires              | `better-auth.session_token` rotated (user logged out / signed in again)   | Re-copy and re-inject                             |
| Domain mismatch                               | Cookie domain must be `localhost` literally, no leading dot for local dev | —                                                 |

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
