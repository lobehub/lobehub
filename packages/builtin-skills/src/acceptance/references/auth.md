# Auth — getting past the login gate (portable)

If the state a criterion checks is behind a login, you must authenticate the
surface **before** capturing — otherwise every screenshot lands on the sign-in
page and the evidence is worthless. Auth is a gate, but it is **surface-scoped**:
authenticate only the surface you're proving on, not all of them.

This file is portable to any Chromium-based app. It does not assume any specific
auth provider, cookie name, or seed script — discover those from the app you are
verifying.

## Decision flow

1. **Is the target behind auth at all?** Open it; if it renders the state under
   test without a login wall, skip this file.
2. **Pick the cheapest mechanism that works for the surface** (table below).
3. **Verify the session is authenticated** before you start capturing: navigate
   to a protected URL and assert you did _not_ get redirected to the sign-in page
   (`agent-browser ... get url` should not be the login route).

## Mechanisms (web / Chrome surface)

`agent-browser` has four built-in ways to carry auth — prefer these over manual
login, which is unreliable in headless/off-screen windows.

```bash
# 1. Named session — auto-saves & restores cookies + localStorage across commands
agent-browser --session app open https://app.example.com/login
# ... complete login once (or inject state) ...
agent-browser --session app open https://app.example.com/dashboard # restored

# 2. State file — export/import a Playwright-style storageState
agent-browser state save auth.json
agent-browser state load auth.json

# 3. Auth vault — store credentials encrypted, replay the login form
echo "$PASSWORD" | agent-browser auth save app --url https://app.example.com/login \
  --username user --password-stdin
agent-browser auth login app

# 4. Persistent profile — a dedicated user-data dir that keeps you logged in
agent-browser --profile ~/.app-profile open https://app.example.com/login
```

### Programmatic login (when the app has an email/password endpoint)

If the app exposes a sign-in API, the most reliable headless path is to POST
credentials, capture the returned cookies, and load them as a state file — no UI
login needed. Shape (adapt the endpoint + cookie handling to the app):

```bash
# POST credentials, save the cookie jar, convert to a storageState file,
# then load it into the agent-browser session and verify you're not on /signin.
# (endpoint, field names, and cookie names are app-specific — inspect them first)
```

### Cookie-injection fallback (local dev only)

When headless login isn't available, copy the session cookie out of a browser
where you're already logged in and inject it:

1. In a logged-in browser, open DevTools → **Network** tab → click any
   same-origin request → **Request Headers** → copy the full `Cookie:` value.
   It MUST come from a Network request, **not** `document.cookie` — HttpOnly
   session cookies are invisible to `document.cookie`.
2. Build a state file with those cookies and `agent-browser state load` it (or use
   the session). Match the cookie **domain exactly** — e.g. `localhost`, not
   `127.0.0.1`, and no leading dot for local dev.
3. Verify: open a protected URL, confirm you're not redirected to sign-in.

Common failure modes:

| Symptom                                    | Cause                                                   | Fix                                            |
| ------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------- |
| Still redirects to sign-in after injection | Copied from `document.cookie` → missed HttpOnly session | Re-copy from a Network request's headers       |
| "no cookies found"                         | Pasted the wrong value                                  | Keep the raw `Cookie:` header verbatim         |
| Works briefly then expires                 | Session token rotated (logged out elsewhere)            | Re-copy and re-inject                          |
| Domain mismatch                            | Cookie domain must match the URL host exactly           | Use the literal host, no leading dot for local |

## Desktop (Electron) {#desktop}

A desktop app usually keeps its own persistent login state in its user-data
directory: **log in once inside the app** and it survives restarts. No injection.
Once connected over CDP, verify auth by reading the app's own signed-in state
(eval its global / a protected element) rather than assuming.

## CLI / backend surface

For text evidence from a CLI, the CLI carries its own auth (an API key or a stored
login). The `lh` CLI you use to upload evidence is already authed; a different
product CLI under test uses its own mechanism — ensure it's configured before
capturing its output.

## Boundaries — read before touching cookies

- **Local dev only.** These injection recipes are for local/dev targets. Don't
  inject cookies on production: production cookies are typically
  `Secure; HttpOnly` over HTTPS and must not be copied around.
- **Treat any cookie/token as a secret.** Never paste it into shared logs, PR
  descriptions, commit messages, or evidence you upload. Evidence artifacts are
  visible to reviewers — a screenshot or text dump must not contain a live token.
- **Injection is one-way.** It seeds the automation session; it does not flow back
  into your own browser.
- **Exercising the login UI itself needs a real browser flow.** If the criterion
  is _about_ the sign-in screen, drive a real Chromium with remote debugging
  rather than injecting past it.
