# Messenger system bots — managed by dc-center

System-level (deployment-wide) messenger bot credentials live in the
`system_bot_providers` DB table. The dc-center admin UI is the **only** place
operators write to that table. lobehub-dev (the main app) reads from it; the
external MessageGateway worker forwards platform events to it.

This page is the architectural overview. For platform-specific setup details
follow:

- [discord-app-setup.md](./discord-app-setup.md)
- [slack-app-setup.md](./slack-app-setup.md)
- (Telegram has no platform-side setup beyond `botToken`; configure directly
  in dc-center.)

## Architecture

```text
        ┌──────────────────────┐
        │   dc-center (admin)  │ writes credentials, toggles enabled,
        │  /agent/system-bots  │ triggers force-reconnect
        └──────────┬───────────┘
                   │ encrypts via shared KEY_VAULTS_SECRET
                   ▼
        ┌──────────────────────┐         ┌────────────────────────────┐
        │  system_bot_providers│◀────────│    lobehub-dev (main app)  │
        │  (Postgres, encrypted│  reads  │ MessengerRouter / binders  │
        │   credentials JSON)  │         │ ensureConnected() / webhook │
        └──────────┬───────────┘         └─────────────┬──────────────┘
                   │                                   │
                   │ register / disconnect             │ outbound REST calls
                   ▼                                   │
        ┌──────────────────────┐                       │
        │  MessageGateway      │ ◀─ forwards events ──┘
        │  (Cloudflare Worker) │
        │  holds Discord WS    │
        └──────────────────────┘
```

The DB row is the source of truth. The other three components read from / sync
to it; nothing else holds long-term credential state.

## Credential lifecycle

| Action in dc-center    | DB effect                   | MessageGateway effect                                      | Main app effect                                        |
| ---------------------- | --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Create                 | INSERT row, `enabled=true`  | next sync registers connection                             | within \~30s the binder picks up new creds (cache TTL) |
| Edit credentials       | UPDATE `credentials` cipher | service `disconnect()` immediately, next sync re-registers | cache invalidated automatically on next miss           |
| Toggle `enabled=false` | UPDATE `enabled`            | service `disconnect()`                                     | webhook returns 503                                    |
| Delete                 | DELETE row                  | service `disconnect()`                                     | platform falls out of `availablePlatforms`             |
| Force Reconnect        | (no row change)             | service `disconnect()`; cron re-registers                  | no change                                              |

## Operational guarantees

- **`KEY_VAULTS_SECRET` MUST be identical** between lobehub-dev and dc-center
  deployments. Both call `KeyVaultsGateKeeper.initWithEnvKey()` which expects
  the same base64-encoded 16/24/32-byte AES-GCM key. If the two values
  diverge, dc-center will save ciphertext lobehub-dev cannot decrypt — the
  binder treats undecryptable rows as `credentials: {}` and silently disables
  the platform (look for `messenger:config: lookup failed` in logs).
- **Plaintext credentials never appear on the wire**. dc-center's TRPC
  `list` / `getById` strip credentials and return only `hasCredentials: boolean`.
  `save` accepts a credentials field but only includes it in writes when the
  operator typed something (an empty edit means "don't change").
- **Rotation**: when dc-center calls `save({ credentials: { ... } })`, the
  service immediately disconnects the live MessageGateway connection by id;
  the next cron tick (\~10min on Vercel; immediate on self-host) re-registers
  with the new ciphertext. Use the **Force Reconnect** button to skip the
  wait.

## Troubleshooting

When a messenger bot stops responding, check in this order:

1. **dc-center → System Bots → live status column**
   - `connected` → MessageGateway holds the WS, problem is downstream (webhook 503? wrong webhook URL?)
   - `connecting` → transient, give it a minute
   - `disconnected` / `error` → click **Force Reconnect** and watch the live status flip back; if not, see step 2
   - `not registered` → cron hasn't synced yet, or MessageGateway not configured at all
2. **MessageGateway dashboard** (`/agent/message-gateway`) — `Connections` tab, search `messenger:` prefix. Look at the `error` field on the live connection.
3. **lobehub-dev server logs** — `lobe-server:messenger:*` debug namespace. Common patterns:
   - `lookup failed for platform=...` → DB unreachable or `KEY_VAULTS_SECRET` mismatch
   - `discord credentials not configured in DB` → row doesn't exist or `enabled=false`
   - `Slack messenger not configured` → 404 webhook response means same as above
4. **Bot platform side** — the App console (Discord Developer Portal / Slack App / Telegram BotFather):
   - Discord: confirm Interactions Endpoint URL is **not set** (Gateway-only); confirm `MESSAGE CONTENT INTENT` is on
   - Slack: confirm webhook URLs in App console match `${APP_URL}/api/agent/messenger/webhooks/slack`

## Why dc-center, not the main app?

Two reasons:

- **Operations vs. application.** dc-center is the existing operations surface
  (where ops sees per-agent bot stats, error logs, MessageGateway health).
  Putting messenger bot management here keeps the operational concerns in one
  place and out of the user-facing main app code.
- **Auth model.** dc-center has admin-only auth already. Adding a "system
  bots" admin UI on lobehub-dev would mean shipping a second permissions tier
  next to user-facing auth, which we don't currently have.
