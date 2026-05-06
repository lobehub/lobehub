# Slack App setup for the LobeHub Messenger

This file explains how to use `slack-app-manifest.yaml` to bring up a Slack App that connects to a LobeHub deployment.

## What you get

One Slack App per environment:

- **Cloud production** — managed by LobeHub, listed on the Slack Marketplace.
- **Cloud staging / dev** — internal, points at the dev domain.
- **Self-hosted** — your own App ID, points at your domain.

Each App's client credentials (`appId` / `clientId` / `clientSecret` / `signingSecret`) are stored in the `system_bot_providers` DB table and managed from dc-center (see [managed-by-dc-center.md](./managed-by-dc-center.md)). The manifest encodes everything else (scopes, event subscriptions, redirect URLs, App Home toggles). Per-tenant Slack workspace tokens (acquired via OAuth on install) still live in `messenger_installations` — that table is unchanged.

## Prerequisites

- A LobeHub deployment reachable on a stable HTTPS URL (`APP_URL`). For local dev use a tunnel — `cloudflared tunnel --url http://localhost:3010`, `ngrok http 3010`, etc. — and set `APP_URL` to the tunnel URL.
- A Slack workspace where you have admin rights (to create / install Apps).

> **Local dev tip**: cloudflared / ngrok hand out a different hostname every restart. When the tunnel URL changes you must update every URL field in the Slack App console (see [Slack URL surfaces](#slack-url-surfaces) below) — Slack does NOT auto-discover them from the manifest file. A long-lived `cloudflared tunnel` (named tunnel with a stable subdomain) avoids this churn.

## First-time setup (per environment)

1. **Edit the manifest** — open `slack-app-manifest.yaml` and replace every occurrence of `https://app.lobehub.com` with your environment's `APP_URL`. There are six URLs (one OAuth redirect, one event subscription, one interactivity, three slash commands) — they must all point at the same domain.
2. **Create the App** — go to <https://api.slack.com/apps>, click **Create New App → From an app manifest**, pick the workspace, paste the YAML, click through.
3. **Copy credentials** — on the App's "Basic Information" page grab `App ID`, `Client ID`, `Client Secret`, `Signing Secret`.
4. **Save credentials in dc-center** — open dc-center → **Agent → System Bots** → **Add Bot** → select platform `Slack` → fill the form:
   | Form field | Slack console field |
   | --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
   | App ID | Basic Information → App ID |
   | Client ID | Basic Information → Client ID |
   | Client Secret | Basic Information → Client Secret |
   | Signing Secret | Basic Information → Signing Secret |
   | Leave **Connection Mode** as `Webhook` (Slack uses signed HTTPS, not WebSocket) and **Enabled** ON. Save. | |
5. **Install to your workspace** — App console → **Install App** → authorize.
6. **Smoke test** — sign into LobeHub web → Messenger settings → click **Connect Slack** → install into a workspace → confirm the OAuth flow lands on `slack.com/app/open`. Then DM `@LobeHub` in Slack: you should get the link prompt, finish account binding, and `/agents` should list your agents.

## Updating the manifest

Slack stores the manifest server-side, so editing the YAML file in the repo doesn't propagate by itself. To roll out a change:

- **Manual**: paste the updated YAML into the App console under **App Manifest → Edit**.
- **Programmatic**: use `apps.manifest.update` with an admin token — useful from CI for staging / dev Apps.

Production App changes go through Slack Marketplace re-review for any scope change. Plan ahead.

> **Re-install required when scopes change.** Adding or removing OAuth scopes (e.g. the `commands` scope for slash commands) silently invalidates existing installations until each workspace reinstalls. After a manifest update, the App console shows a yellow **Reinstall to Workspace** banner — click it for your dev workspace, and existing user installations need to re-authorize through the LobeHub Messenger settings.

## Slack URL surfaces

Slack treats each surface as a separately-configured endpoint, even when they all point at the same handler. There are six URL fields in total — one OAuth redirect, one event subscription, one interactivity, and one per slash command (currently three):

| Surface             | Console location                         | Where it lives in this repo                      |
| ------------------- | ---------------------------------------- | ------------------------------------------------ |
| OAuth redirect      | OAuth & Permissions → Redirect URLs      | `/api/agent/messenger/slack/oauth/callback`      |
| Event subscriptions | Event Subscriptions → Request URL        | `/api/agent/messenger/webhooks/slack`            |
| Interactivity       | Interactivity & Shortcuts → Request URL  | `/api/agent/messenger/webhooks/slack` (same)     |
| Slash commands      | Slash Commands → per-command Request URL | `/api/agent/messenger/webhooks/slack` (same, ×3) |

The webhook handler dispatches by payload shape — so events, interactivity, and all three slash commands can share one URL — but **every URL field must still be filled in independently**. Re-importing the manifest sets all of them at once; a manual change only updates the field you touched.

> Re-importing the manifest is the safest way to update URLs after a tunnel restart. If you only edit one section by hand, the others silently keep pointing at the old URL.

## Scope rationale

| Scope                  | Why                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat:write`           | Post DM responses + the first-time link prompt                                                                                                                                              |
| `im:history` `im:read` | Read the user's DM messages so the bot can reply                                                                                                                                            |
| `im:write`             | Open the IM channel for `notifyLinkSuccess` after the user binds                                                                                                                            |
| `commands`             | Required for the `/agents`, `/new`, `/stop` slash commands (without it, the manifest's `slash_commands` block is silently ignored)                                                          |
| `reactions:write`      | Inline feedback emoji on the user's message (👀 "processing" → ✅ done)                                                                                                                     |
| `users:read`           | Resolve `slack_user_id` → user profile                                                                                                                                                      |
| `users:read.email`     | Pull `email` for the verify-im URL prefill (the user can still edit it)                                                                                                                     |
| `files:read`           | Download user-uploaded attachments via `url_private` so vision / file-aware agents see the actual bytes. Without it Slack returns an HTML login page and the agent silently loses the file. |

> **Why narrower than `docs/usage/channels/slack.zh-CN.mdx`?** The two paths are different products. The channel docs cover a per-agent bot a user installs themselves and may use for @mentions / channel reads / Slack AI assistant — needs the full set. The messenger app is the LobeHub-distributed Marketplace App, DM-only in v1, so we ask for the minimum that delivers the feature. Smaller scope = friendlier consent screen and faster Marketplace review.

Future batched scope additions (each triggers Marketplace re-review, so keep batched):

- **PR3 — channel support**: `app_mentions:read` (channel mentions), `channels:history` + `channels:read`, `groups:history` + `groups:read` (private channels), `reactions:read` (act on user-added reactions like ❌ to cancel).
- **PR4 — Slack AI Assistant integration**: `assistant:write` plus the `assistant_thread_started` / `assistant_thread_context_changed` events.
- **Future — multi-person DMs**: `mpim:history`, `mpim:read`, plus the `message.mpim` event.

## Slash commands

The manifest registers three commands that mirror the Telegram bot:

| Command   | What it does                                                                                  |
| --------- | --------------------------------------------------------------------------------------------- |
| `/agents` | List the user's agents and switch the active one (with `[number]` arg or interactive picker). |
| `/new`    | Start a new conversation (clear the cached topic for the user's bot DM).                      |
| `/stop`   | Stop the currently-running agent execution.                                                   |

> **`/start` and `/help` are intentionally omitted.** Slack apps bind to a workspace via OAuth and the per-user link flow auto-fires on first DM, so the Telegram-style `/start` is redundant. `/help` is reserved by Slack for built-in workspace help and can't be registered by third-party apps.

Slash commands invoked from a non-DM channel reply ephemerally so the output stays private. `/new` and `/stop` need a live chat-sdk thread instance the slash-command path doesn't surface yet — they ack with a hint asking the user to send `/new` or `/stop` inside the bot DM, where the in-message `parseCommand` path picks them up. (Wiring `chat.openDM(userId)` so they work directly from the slash command is tracked separately.)

## Troubleshooting

- **"url_verification" challenge fails on first save**: your webhook URL isn't reachable from Slack, or the `signingSecret` saved in dc-center doesn't match the App's signing secret. Check the LobeHub server logs and re-paste the secret from the App's Basic Information page into dc-center.
- **OAuth callback 400 "invalid state"**: the install state expired (10-min TTL) or Redis lost it. Restart the install from the LobeHub modal.
- **App installs but DMs do nothing**: check `messenger_installations` has a row for the `team_id`. If yes, the bot token might not have been saved with the right credentials JSON shape — see the OAuth callback logs. Also confirm the **Event Subscriptions** Request URL is set (manifest field, not auto-set if you only created the App via console-create-without-manifest).
- **Slash commands don't show up in Slack autocomplete**: the `commands` OAuth scope is missing. Slack silently ignores the manifest's `slash_commands` block without it. Add `commands` under `oauth_config.scopes.bot`, re-import the manifest, and reinstall the App to the workspace.
- **`Unknown command: /foo`**: that command isn't registered for your App. Either the manifest hasn't been re-imported since you added it, or you only added some commands manually under **Slash Commands** instead of pasting the full manifest.
- **Slash command picker appears but tapping a button shows "Slack cannot handle payload"**: the **Interactivity & Shortcuts → Request URL** is empty or stale. Slack treats it as a separate endpoint from Event Subscriptions / Slash Commands — fill it in (same URL as the others) and save. No reinstall needed for this change.
- **`channel_not_found` from `chat.postMessage` after `/agents`**: a code bug where the chat-sdk-wrapped channel id (e.g. `slack:D012...`) was passed to the raw Slack API instead of the bare id. Fixed in `MessengerRouter.handleSlackSlashCommand` via `client.extractChatId(...)` — if you see this in your fork, port that strip step.
- **After tunnel restart, everything 401s or silently no-ops**: the tunnel hostname changed but the four Slack URLs still point at the old one. Re-paste the manifest with the new hostname and reinstall.
