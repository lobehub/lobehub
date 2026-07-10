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
| `$SCRIPT cli-seed`             | Configure CLI API-key auth from the seeded key     |
| `$SCRIPT cli`                  | Interactive CLI device-code login (user must run)  |
| `$SCRIPT open-chrome`          | Open Chrome at `SERVER_URL` with DevTools          |
| `$SCRIPT web-seed`             | Sign in the seeded user and inject cookies         |
| `pbpaste \| $SCRIPT web`       | Inject a copied Cookie header into agent-browser   |
| `$SCRIPT web-verify`           | Live-check agent-browser session auth              |

Use `localhost` for Web auth; better-auth cookies are stored for `localhost`,
not `127.0.0.1`.

## Per-surface overview

| Surface  | Mechanism                                | Persistence                                                       | Human interaction                              |
| -------- | ---------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| CLI      | Seeded API key or OIDC Device Code Flow  | `.records/env/agent-testing-cli.env` + `$HOME/.lobehub-dev`       | No for seed path; yes for device-code fallback |
| Web      | Seeded better-auth login or cookie copy  | `~/.lobehub-agent-testing/web-state.json` + agent-browser session | No for seed path; copy cookie only as fallback |
| Electron | App's own login state                    | `~/.lobehub/agent-testing/electron-login` (snapshot on `stop`)    | No — the agent drives the sign-in itself       |
| Bot      | Native apps (Discord/WeChat/…) logged in | Each app's own session                                            | Once per app                                   |

## CLI — Seeded API key

For the self-contained no-root-`.env` dev environment, seed the baseline user
and API key once:

```bash
./.agents/skills/agent-testing/scripts/init-dev-env.sh seed-user
source .records/env/agent-testing-cli.env
./.agents/skills/agent-testing/scripts/setup-auth.sh cli-seed
```

The seed step writes `LOBE_API_KEY` for humans and maps it to the CLI's current
auth variable, `LOBEHUB_CLI_API_KEY`. It also sets `LOBEHUB_SERVER` so CLI
commands hit the local server without needing a stored device-code token.

Use this for automated CLI verification:

```bash
cd apps/cli
source ../../.records/env/agent-testing-cli.env
bun src/index.ts <command>
```

## CLI — Device Code Flow fallback

Use device-code login only when testing against a non-seeded environment.
Credentials are isolated from the user's real CLI config via
`LOBEHUB_CLI_HOME=.lobehub-dev`, which the current CLI stores under
`$HOME/.lobehub-dev`.

```bash
cd apps/cli && LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts login --server http://localhost:3010
```

- The `--server` flag is required — an env var does NOT work and login will hit
  the wrong server without it.
- Check state without logging in: `setup-auth.sh status` (verifies
  `LOBEHUB_CLI_API_KEY` when present, otherwise checks the stored server URL).
- `UNAUTHORIZED` on API calls means the token expired — re-run login.

## Web — seeded better-auth login

The Web test surface is `agent-browser --session lobehub-dev`. The user's
ordinary Chrome is only a cookie source; Chrome screenshots, Chrome Network
records, and Chrome logged-in state do not prove the agent-browser test session
is authenticated.

For the seeded local dev environment, use the automatic path:

```bash
./.agents/skills/agent-testing/scripts/init-dev-env.sh seed-user
./.agents/skills/agent-testing/scripts/setup-auth.sh web-seed
```

`web-seed` posts the seeded email/password to
`/api/auth/sign-in/email`, stores the returned cookie jar under
`~/.lobehub-agent-testing/`, converts it to Playwright `storageState`, loads it
into the `agent-browser` session, and verifies the session does not land on
`/signin`.

## Web — manual cookie injection fallback

`agent-browser --headed` on macOS often creates the Chromium window off-screen —
the user can't see or interact with it, so manual login inside the agent-browser
session fails. Instead, copy the **better-auth session cookie** out of the
user's own logged-in Chrome and inject it as a Playwright-style state file.

Do **not** use this on production URLs — only local dev. Treat the cookie as a
secret: don't paste it into shared logs, PRs, or commit it anywhere.

### Web — decision flow

1. `$SCRIPT status --surface web` — green? Start testing. Do not ask for a Cookie header.
2. Not green and using the seeded local env → `$SCRIPT web-seed`.
3. If repo-root `.env` exists and `web-seed` fails, do **not** seed or modify the current DB; treat it as an existing local environment and use Cookie injection.
4. Still not green or not using the seed env → `$SCRIPT open-chrome` opens Chrome at `SERVER_URL` with DevTools.
5. User copies the `Cookie:` header from Network tab → any same-origin request → Request Headers → right-click `Cookie:` → **Copy value**. Must be from Network, NOT `document.cookie` (HttpOnly cookies are invisible to `document.cookie`).
6. `pbpaste | $SCRIPT web` — filters to better-auth cookies (`session_token`, `session_data`, `state`), builds Playwright `storageState`, loads it into the `agent-browser` session (`lobehub-dev`), opens `SERVER_URL`, and asserts the URL is not `/signin`.

`ENABLE_MOCK_DEV_USER` is not Web auth. It only affects server-side API context
and does not satisfy Better Auth or stop the SPA from redirecting to `/signin`.
Do not use it as a substitute for `status --surface web` or Cookie injection.

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

The desktop app keeps its login in its user-data directory. Pool instances get a
throwaway userData, so `electron-dev.sh` persists the login **for you**: `stop`
snapshots it into `~/.lobehub/agent-testing/electron-login` before wiping the dir,
and `start` seeds every new instance from that snapshot. Sign in once, not once
per run.

```bash
EDEV=./.agents/skills/agent-testing/scripts/electron-dev.sh
$EDEV login-status        # which source seeds the next instance, and its expiry
$EDEV save-login <id>     # snapshot a live instance without stopping it
```

The standard check (do NOT hand-roll a store eval) once Electron is up with CDP:

```bash
./.agents/skills/agent-testing/scripts/app-probe.sh auth
# → {"ok":true,"isSignedIn":true,"userId":"user_xxx"}
```

`setup-auth.sh status` runs this probe automatically when CDP 9222 is
reachable.

### When the instance comes up signed out

Sign it in **yourself** — never hand this step to the user. The desktop flow is
OAuth+PKCE against `/oidc/auth`, and the redirect target is a **server page the app
then polls** (`/oidc/callback/desktop`), not a `lobehub://` deep link — so no other
app can steal the callback, and no click is needed when the default browser already
has a LobeHub session:

```bash
agent-browser --session s<port> --cdp <port> eval --stdin << 'EOF'
(async () => {
  const m = await import('/src/services/electron/remoteServer.ts');
  return JSON.stringify(await (m.remoteServerService || m.default).requestAuthorization({ storageMode: 'cloud' }));
})()
EOF
# poll until user().user.id appears, then capture it:
$EDEV save-login <id>
```

Three traps behind a signed-out instance:

- **The refresh token rotates on every boot.** Only the instance that booted last
  holds a usable one, so a `stop` is what keeps the snapshot alive. If an instance is
  _killed_ instead (crash, command timeout) its rotated token dies with it —
  `save-login <id>` before anything risky.
- **`encryptedTokens.expiresAt` is the ACCESS token's expiry, not the refresh
  token's.** It is `Date.now() + data.expires_in * 1000` in
  `RemoteServerConfigCtr.saveTokens`, so it goes stale on a perfectly refreshable
  login and must never gate whether a profile is kept. The signal that _does_ mean
  signed out is a **missing `refreshToken`**: the app calls `clearTokens()` (deleting
  the whole `encryptedTokens` key) when a refresh fails non-retryably
  (`invalid_grant` \&co), and preserves it on transient failures.
- **Even a missing token does not always mean signed out.** A better-auth cookie can
  outlive it. `stop` / `save-login` probe the _running renderer_ for a user id, so a
  live cookie-only session is captured too; the on-disk token alone would miss it.

## Scope

These recipes only cover **local dev** authentication. They do not:

- Work for production — production cookies are `Secure; HttpOnly; Domain=.lobehub.com`
  and must be delivered over HTTPS.
- Replace real OAuth flows — tests that must exercise the login UI itself need a
  real Chromium with `--remote-debugging-port` or a bot account.
- Flow cookies back to the user's Chrome — injection is one-way.
