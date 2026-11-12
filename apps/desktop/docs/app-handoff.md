# Local app sign-in handoff

A signed-in LobeHub Desktop can let another native app on the same machine sign in with the same account, without a browser round trip. The other app never sees a Desktop token. Desktop asks its server for a **one-time, 60-second authorization code issued to the other app's own OIDC client and bound to that app's PKCE challenge**. The app redeems it at the standard token endpoint with its own `code_verifier`, and gets its own grant, access token, refresh token and id_token.

Which apps may do this is decided by the server (`OIDC_NATIVE_HANDOFF` business slot, empty by default = off).

```
native app                        Desktop (main process)                    server (OIDC provider)
  │ read ~/.lobehub/desktop-handoff/<channel>.json                              │
  │ PKCE verifier/challenge, state; listen on 127.0.0.1:P                       │
  │ POST 127.0.0.1:<port>/app-handoff/v1/code ─▶│                               │
  │                                             │ request guards, peer process, │
  │                                             │ signature / install check or  │
  │                                             │ user confirmation             │
  │                                             │ POST /oidc/handoff/native ───▶│ validate Desktop token,
  │                                             │  Oidc-Auth: <Desktop AT>      │ policy, issuer, user,
  │                                             │                               │ redirect, PKCE, scope,
  │                                             │                               │ rate limit; new Grant;
  │                                             │◀── { code, iss, expires_in } ─│ 60 s AuthorizationCode
  │◀── 200 { code, state, iss, expires_in } ────│                               │
  │ POST /oidc/token grant_type=authorization_code, client_id=<own>, code_verifier ───────────▶│
  │◀──────────────────── own access_token / refresh_token / id_token ──────────────────────────│
```

## Discovery file

While Desktop is signed in **and** its server lists at least one handoff target, it listens on `127.0.0.1:<random port>` and writes `~/.lobehub/desktop-handoff/<channel>.json` (directory `0700`, file `0600`, `channel` = `stable | beta | nightly | dev`):

```json
{
  "channel": "stable",
  "issuer": "https://app.example.com/oidc",
  "pid": 4321,
  "port": 51234,
  "v": 1
}
```

It holds no token and no user data. Desktop removes it (and stops listening) on sign-out, on a server switch and on quit; a file whose `pid` is not running is stale.

## `POST /app-handoff/v1/code`

`Content-Type: application/json`, body ≤ 4 KB, `Host` must be exactly `127.0.0.1:<port>`.

| Field                   | Type     | Required | Meaning                                                                                             |
| ----------------------- | -------- | -------- | --------------------------------------------------------------------------------------------------- |
| `client_id`             | string   | yes      | The caller's own registered `native` OIDC client; must be on the server's target list               |
| `code_challenge`        | string   | yes      | S256 PKCE challenge (43–128 base64url chars) of a verifier only the caller holds                    |
| `code_challenge_method` | `"S256"` | no       | Only `S256`                                                                                         |
| `issuer`                | string   | yes      | The issuer the caller is configured for; must equal Desktop's `<server>/oidc`                       |
| `redirect_uri`          | string   | yes      | `http://127.0.0.1:<port>/…` / `http://[::1]:<port>/…` served by the caller; the code is bound to it |
| `state`                 | string   | yes      | ≤ 512 chars, echoed back                                                                            |
| `scope`                 | string   | no       | Subset of `openid profile email offline_access` (default: all four; `openid` required)              |
| `resource`              | string   | no       | Only `urn:lobehub:chat`                                                                             |
| `sub`                   | string   | no       | When the caller already holds a session: its user. A different Desktop user is refused              |

`200`:

| Field        | Type   | Meaning                                                                       |
| ------------ | ------ | ----------------------------------------------------------------------------- |
| `code`       | string | One-time authorization code for `client_id`                                   |
| `expires_in` | number | `60` seconds                                                                  |
| `iss`        | string | Issuer; the caller must compare it with its own (RFC 9207 style mix-up check) |
| `state`      | string | The request's `state`                                                         |

Redeem at the discovery `token_endpoint`: `grant_type=authorization_code&client_id=<own>&code&code_verifier&redirect_uri` (same `redirect_uri`). A second redemption, a redemption after 60 s, with another verifier, another client or another redirect fails with `invalid_grant`.

## `GET /app-handoff/v1/status`

`200 { "signedIn": true, "issuer": "…", "sub": "user_…" }`. `sub` is only returned to a caller recognised without asking (verified executable or previously allowed); a status request never opens a dialog.

## Errors

Body: `{ "error": "<code>", "error_description": "…" }`.

| HTTP | `error`                       | When                                                                                                                                                                                             |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `invalid_request`             | Bad/missing field, non-JSON body, body > 4 KB, non-loopback redirect, non-S256 challenge; server-side scope/resource/redirect refusals                                                           |
| 401  | `not_signed_in`               | Desktop not signed in, or its token was rejected                                                                                                                                                 |
| 403  | `forbidden`                   | Browser-originated request (`Origin`, `Referer`, `Sec-Fetch-*`), wrong `Host`, caller process cannot be identified or runs as another OS user, `redirect_uri` port not listened on by the caller |
| 403  | `denied`                      | The user declined in the confirmation dialog, or did not answer in 60 s                                                                                                                          |
| 403  | `unauthorized_client`         | `client_id` is not a handoff target                                                                                                                                                              |
| 404  | `not_available` / `not_found` | Server has handoff switched off / unknown path                                                                                                                                                   |
| 405  | `method_not_allowed`          | Wrong method (including CORS preflights)                                                                                                                                                         |
| 409  | `issuer_mismatch`             | Desktop is signed in to another server; body also carries Desktop's `issuer`                                                                                                                     |
| 409  | `user_mismatch`               | `sub` differs from the Desktop user                                                                                                                                                              |
| 429  | `rate_limited`                | > 10 local requests / minute, or > 5 handoffs / user / minute on the server                                                                                                                      |
| 502  | `server_error`                | Server unreachable or unexpected server response                                                                                                                                                 |

The caller should fall back to its own browser sign-in on any error.

## Deep link variant

When Desktop is installed but not running, the app may open `<scheme>://app/handoff?<same fields as the JSON body>`. Anything can open a deep link, so Desktop **always** asks the user, and the result only travels as `POST <redirect_uri>` (`application/x-www-form-urlencoded`: `code`, `state`, `iss`, or `error`, `state`), never in a URL. Desktop first checks that the `redirect_uri` port is listened on by a process of the same OS user; otherwise it sends nothing at all, not even an error.

## Who may call

1. Request guards (above): loopback only, exact `Host`, no browser headers, JSON only, size limit, no CORS headers in responses.
2. The peer process is resolved from the TCP source port (Linux `/proc/net/tcp*` → socket inode → `/proc/<pid>`, macOS `lsof` matching the exact `127.0.0.1:<src>->127.0.0.1:<port>` connection, Windows `Get-NetTCPConnection`). A caller that cannot be resolved, or runs as another OS user, is refused with `forbidden` — never offered a dialog. The `redirect_uri` port must be listened on by the same process.
3. Its executable is checked against the target's `verification` from the server: macOS `codesign --verify --strict -R=<designatedRequirement>`, Windows `Get-AuthenticodeSignature` (valid + exact signer subject), Linux real path inside a listed directory whose every ancestor is root-owned and not group/other-writable.
4. Unverified → native confirmation dialog naming the app and program path; "Always allow this program" remembers path + size + mtime (`appHandoffTrustedApps`), so an updated or replaced binary asks again.

Same-user malware is outside the threat model (as in RFC 8252): such a process can already drive Desktop's UI or read browser cookies.

## Token independence

- Desktop's refresh token is never sent, logged or used by the handoff. Desktop only sends its access token, and only to its own server. A token close to expiry is renewed through Desktop's usual single-flight refresh, and only after every check and the user's consent have passed, so no outside process can make Desktop rotate its refresh token (status requests never refresh).
- The code request always names the account the checks and the user's consent covered (the caller's `sub`, or Desktop's own when the caller sent none). If Desktop switches accounts while the dialog is open, the server refuses with `user_mismatch` instead of issuing a code for the new account.
- Every request to the server's handoff endpoint times out after 10 seconds, so a server that never answers cannot hold up Desktop's session-change handling (sign-out, server switch).
- Every handoff creates a new grant for the target client. Refresh-token rotation and reuse detection are per grant, so either side can refresh, rotate or be revoked without affecting the other.
- Signing out of the native app (revoking its refresh token at `/oidc/token/revocation`) ends only its grant. Signing out of Desktop closes the local interface and leaves the native app's grant alone.

## Server endpoint

`GET|POST /oidc/handoff/native`, authenticated with the caller's access token (`Oidc-Auth` or `Authorization: Bearer`). The token's issuer and `urn:lobehub:chat` audience are checked, its `client_id` must be on `OIDC_NATIVE_HANDOFF.from`, the user must be active, and the grant named by the token's `grant_id` claim must still hold a live (unconsumed, unexpired) refresh token for that user and client — access tokens are stateless JWTs that outlive a revoked grant, and Desktop shares its access token with local agent runs. Binding the check to the token's own grant keeps a revoked token from passing on the strength of a later sign-in; a token issued before the claim existed is refused until Desktop refreshes it, and the native app meanwhile uses its own sign-in. `GET` returns `{ issuer, sub, targets: [{ client_id, name, verification }] }`. `POST` takes the code request fields above (except `state`) and returns `{ code, iss, expires_in }`; errors use the server codes `invalid_token`, `unauthorized_client`, `issuer_mismatch`, `user_mismatch`, `invalid_redirect_uri`, `invalid_scope`, `invalid_target`, `invalid_request`, `access_denied`, `rate_limited`, `not_available`.

Audit lines (JSON payload, never the code or a token):

- `[OIDC] native handoff issued` — `from`, `to`, `sub`, `grantId`, `expiresIn`, `ip`, `userAgent`
- `[OIDC] native handoff rejected` — `error`, `reason`, `from`, `to`, `sub`, `ip`
- `[OIDC] native client code redeemed` — `clientId`, `grantId`, `sub` (ties to the issued line)
- `[OIDC] grant rejected` / `[OIDC] grant revoked` — replayed or expired codes
- Desktop: `[AppHandoff] issuing code` (client, pid, exe path, verified) and `[AppHandoff] refused` (error, reason)

## Known limits

- A process running as the same OS user that obtains Desktop's **access token** (Desktop hands it to local agent runs through the CLI sign-in file) can call the server endpoint directly while Desktop's session is live, bypassing the local caller checks. This is inside the "same-user malware" exclusion above, but it turns a 7-day access token into an independent refresh token. Closing it fully needs a credential only Desktop's main process holds, e.g. DPoP-bound Desktop tokens or a handoff-only token that is never written to the CLI file.
