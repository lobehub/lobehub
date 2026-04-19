# Log `agent-browser` into a local LobeHub dev server

`agent-browser --headed` on macOS often creates the Chromium window off-screen — the user can't see or interact with it, so manual login inside the agent-browser session fails. Instead of sharing the user's real Chrome profile, copy the **better-auth session cookie** out of a request in DevTools and inject it into the agent-browser session as a Playwright-style state file.

## When to use

- You need `agent-browser` to reach an authenticated page on `http://localhost:<port>` (e.g. `localhost:3011`).
- The user already has a logged-in tab of the same dev server in their own Chrome.
- Spawning a headed Chromium to let the user log in manually is unreliable (window off-screen, no interaction).

Do **not** use this on production URLs — only local dev. Treat the cookie as a secret: don't paste it into shared logs, PRs, or commit it anywhere.

## Step 1 — Ask the user to copy the cookie from a Network request, NOT `document.cookie`

`document.cookie` will not return HttpOnly cookies, which is exactly where better-auth puts its session. Instruct the user:

1. Open the logged-in tab (`http://localhost:<port>/…`) in their own Chrome.
2. `Cmd+Option+I` → **Network** tab.
3. Refresh, click any same-origin request (e.g. the top-level document request).
4. In the right pane under **Request Headers**, right-click the `Cookie:` line → **Copy value** (or copy the entire header).
5. Paste the string into chat.

You only need the better-auth pieces. Everything else (Clerk, `LOBE_LOCALE`, HMR hash, theme vars) is noise and can stay. The minimum viable set is:

```
better-auth.session_token=<value>; better-auth.state=<value>
```

## Step 2 — Build a Playwright-style state file

`agent-browser state load` expects Playwright's `storageState` format: a JSON with a `cookies` array and an `origins` array.

```bash
cat > /tmp/mkstate.py << 'PY'
import json, sys, time

# Read the Cookie header from stdin (allows optional "Cookie: " prefix).
raw = sys.stdin.read().strip()
if raw.lower().startswith("cookie:"):
    raw = raw.split(":", 1)[1].strip()

# Keep only better-auth cookies. Extend this set if the app genuinely needs more.
WANTED = {"better-auth.session_token", "better-auth.state"}

cookies = []
exp = int(time.time()) + 30 * 24 * 3600  # 30 days
for pair in raw.split("; "):
    if "=" not in pair:
        continue
    name, _, value = pair.partition("=")
    if name not in WANTED:
        continue
    cookies.append({
        "name": name,
        "value": value,
        "domain": "localhost",
        "path": "/",
        "expires": exp,
        "httpOnly": False,
        "secure": False,
        "sameSite": "Lax",
    })

if not cookies:
    sys.stderr.write("no better-auth cookies found in input\n")
    sys.exit(1)

print(json.dumps({"cookies": cookies, "origins": []}, indent=2))
PY

# Feed the copied Cookie header in via env var or heredoc.
printf '%s' "$COOKIE_HEADER" | python3 /tmp/mkstate.py > /tmp/state.json
```

**Note on `httpOnly`**: the real cookie in the user's browser is HttpOnly, but `storageState` doesn't enforce the flag on load — it just attaches the value. Storing with `httpOnly: false` is fine for local dev and sidesteps a CDP-context quirk where HttpOnly cookies sometimes fail to attach.

## Step 3 — Load state and navigate

```bash
SESSION="my-test" # any stable session name

agent-browser --session "$SESSION" state load /tmp/state.json
agent-browser --session "$SESSION" open "http://localhost:3011/"
agent-browser --session "$SESSION" get url
# Expect NOT /signin?callbackUrl=… — if you still see signin, cookie didn't apply.
```

## Step 4 — Verify

```bash
agent-browser --session "$SESSION" snapshot -i | head -20
# Look for the user's avatar/name in the sidebar, or absence of the signin form.
```

## Common failure modes

| Symptom                                         | Cause                                                                   | Fix                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Still redirects to `/signin` after `state load` | User pasted from `document.cookie` → missed HttpOnly session            | Re-pull from Network request Headers, not console    |
| `state load` reports 0 cookies                  | Separator wrong, or user pasted URL-decoded value                       | Keep the raw `Cookie:` header as-is; split on `"; "` |
| Login works briefly then expires                | `better-auth.session_token` rotated (user logged out / signed in again) | Re-copy and re-load                                  |
| Domain mismatch                                 | Use `domain: "localhost"` literally, no leading dot for local dev       | —                                                    |

## Scope

Only covers authenticating an **agent-browser** session into a **local** LobeHub dev server. It does not:

- Work for production — production cookies are `Secure; HttpOnly; Domain=.lobehub.com` and must be delivered over HTTPS.
- Replace real OAuth flows — tests that must exercise the login UI need a real Chromium with `--remote-debugging-port` or a bot account.
- Flow cookies back to the user's Chrome — injection is one-way (into agent-browser only).
