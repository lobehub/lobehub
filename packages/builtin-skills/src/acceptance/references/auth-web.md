# Web authentication with agent-browser

Use this reference only when the Web criterion is behind a login gate.
Authenticate the same named `agent-browser` session that will capture evidence;
a screenshot from a different browser does not prove the automated session
reached the state.

This workflow is provider-neutral. Discover the target's actual endpoint, cookie
domain, and session mechanism before selecting a path.

## Decision flow

1. Open the protected target. If it renders without a login wall, stop here.
2. Prefer a named session or state file; use credential replay or cookie injection
   only when required.
3. Reopen a protected URL and verify that `agent-browser get url` did not return
   the sign-in route before capturing evidence.

## Built-in mechanisms

```bash
# Named session: persists cookies and localStorage.
agent-browser --session app open https://app.example.com/login
# Complete login once, then reuse the same session.
agent-browser --session app open https://app.example.com/dashboard

# Playwright-style storage state.
agent-browser state save auth.json
agent-browser state load auth.json

# Encrypted credential vault and form replay.
echo "$PASSWORD" | agent-browser auth save app \
  --url https://app.example.com/login --username user --password-stdin
agent-browser auth login app

# Dedicated persistent browser profile.
agent-browser --profile ~/.app-profile open https://app.example.com/login
```

## Programmatic login

If the app exposes a sign-in API, POST credentials, capture the returned cookies,
convert them to a storage-state file, and load that state into the evidence
session. Endpoint shape, field names, and cookie names are app-specific; inspect
them rather than assuming.

## Cookie-injection fallback for local development

1. In a logged-in browser, open DevTools Network, select a same-origin request,
   and copy the full `Cookie:` request header. Do not use `document.cookie`;
   HttpOnly session cookies are invisible there.
2. Build a state file and load it into the named session. Match the cookie domain
   exactly (`localhost` is not `127.0.0.1`; local domains need no leading dot).
3. Open a protected URL and verify that the session is not redirected.

| Symptom                     | Cause                                                 | Fix                                      |
| --------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| Redirects after injection   | `document.cookie` omitted the HttpOnly session        | Copy the Network request's cookie header |
| "no cookies found"          | The copied value is not the raw request cookie header | Preserve the header value verbatim       |
| Works briefly, then expires | The session rotated or expired                        | Acquire and inject a fresh dev session   |
| Works on one host spelling  | Cookie domain and target host differ                  | Use the literal target host              |

## Security boundaries

- Restrict cookie injection to local/development targets. Do not move production
  session cookies into automation state.
- Treat credentials, cookies, and tokens as secrets. Never place them in logs,
  evidence, commits, or PR descriptions.
- Authentication state seeds only the automation session; it does not flow back
  into the source browser.
- When the criterion is the sign-in UI itself, drive the real form instead of
  injecting past it.

Return to the selected Web flow after the authenticated session passes its
protected-route check.
