# Discord App setup for the LobeHub Messenger

This file explains how to bring up a Discord App that connects to a LobeHub deployment as the Messenger bot. It mirrors `slack-app-setup.md` so the two surfaces stay legible side-by-side.

## What you get

One Discord App per environment:

- **Cloud production** — managed by LobeHub, listed wherever Discord apps surface.
- **Cloud staging / dev** — internal, points at the dev domain.
- **Self-hosted** — your own App ID, points at your domain.

Each App's credentials are stored in the `system_bot_providers` DB table and managed from dc-center (see [managed-by-dc-center.md](./managed-by-dc-center.md)). Unlike Slack, Discord does **not** issue per-guild bot tokens — the same App-level Bot Token works in every guild the bot is invited to, so there is no OAuth callback or per-tenant install row.

## Prerequisites

- A LobeHub deployment reachable on a stable HTTPS URL (`APP_URL`). For local dev use a tunnel — `cloudflared tunnel --url http://localhost:3010`, `ngrok http 3010`, etc. — and set `APP_URL` to the tunnel URL.
- A Discord account that can create applications at <https://discord.com/developers/applications>.
- A Discord server (guild) where you have **Manage Server** permission, to invite the bot for testing.
- Access to the dc-center admin UI (where credentials are stored) and a `KEY_VAULTS_SECRET` env value shared between lobehub-dev and dc-center.

> **Local dev tip**: tunnel hostnames change per restart. Discord's Interactions Endpoint URL must be updated every time, and Discord re-runs its PING signature check the moment you save — if the URL is stale or the public key is wrong, the save button rejects with `Validation failed`. A stable named tunnel avoids this churn.

## First-time setup (per environment)

1. **Create the App** — Discord Developer Portal → **New Application**, give it a name, accept the developer ToS.
2. **Add a Bot user** — left sidebar → **Bot**. Discord auto-creates a bot user matching the Application name. Optionally rename it (this is what users see).
3. **Enable required Privileged Gateway Intent** — same Bot page → **Privileged Gateway Intents** → toggle **MESSAGE CONTENT INTENT** on. The messenger reads the user's DM text (verify-im triggers, `parseCommand` for `/agents`, etc.) and Discord blocks `content` field access without this opt-in. (`PRESENCE` and `SERVER MEMBERS` intents are NOT needed for v1.)
4. **Copy credentials** — keep these handy for step 5:
   - **General Information** page → **Application ID** (this also doubles as the bot user ID)
   - **General Information** page → **Public Key**
   - **Bot** page → **Reset Token** → copy the new token (the old token is invalidated immediately, so do this when you're ready to paste into dc-center)
   - Optional: bot username (used in UI strings only)
5. **Save credentials in dc-center** — open dc-center → **Agent → System Bots** → click **Add Bot** → select platform `Discord` → fill the form:
   | Form field | Discord console field |
   | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
   | Application ID | General Information → Application ID |
   | Bot Token | Bot → Token (after Reset) |
   | Public Key | General Information → Public Key |
   | Bot Username (optional) | Bot → Username |
   | Leave **Connection Mode** as `WebSocket` and **Enabled** ON. Save. The row appears in the table; live status will flip to `connecting` then `connected` within a minute (cron-driven sync). | |
6. **Invite the bot to a guild** — sign into LobeHub web → Messenger settings → click **Discord** → **Add to Discord server**. The OAuth2 install URL (`bot` + `applications.commands` scope, permission bitfield `309237763136`) is built by `buildDiscordInviteUrl()`; it opens Discord's "Add to Server" picker.
7. **Smoke test** — DM the bot in Discord (its profile is reachable from any shared guild's member list, or from the **Open in Discord** link in LobeHub's LinkModal). You should get the link prompt; click the verify-im URL, finish account binding, then send `/agents` as plain text in the DM — the bot replies with your agent list.

> **Do NOT set the Interactions Endpoint URL** in the Developer Portal. Discord's two interaction-delivery paths are mutually exclusive: configuring an Interactions Endpoint URL **opts the bot out** of receiving interactions over the Gateway. Since we already have a persistent Gateway connection (required for DMs anyway — Discord never delivers `MESSAGE_CREATE` to the Interactions URL), the Gateway path covers slash commands and button clicks too. Leaving the field blank keeps everything on one channel and avoids a second PING handshake to verify the URL.

## Updating the App

Discord stores App config server-side, so editing this doc doesn't propagate. To roll out a change:

- Settings (intents, scopes, redirect URLs) → edit in the Developer Portal directly.
- Bot token rotation → **Reset Token** in the portal, then dc-center → System Bots → edit the Discord row → paste new token → save. The service auto-disconnects the running gateway connection so the next sync re-registers with the new token; click **Force Reconnect** to skip the wait.
- Public key (only changes if Discord rotates it for you, very rare) → same flow as token rotation.

> **Re-invite required when scopes change.** If you later add `applications.commands` (e.g. for slash commands; see LOBE-8489) to an App that was originally invited with only `bot`, existing guilds need to re-run the invite URL to grant the new scope. The bot token itself stays valid.

## Discord URL surfaces

Compared to Slack's six explicitly-configured surfaces, Discord has **zero** that the operator configures in the Developer Portal — everything flows over the Gateway WebSocket and gets forwarded to one local endpoint:

| Surface           | How it reaches the server                                                               | Where it lives in this repo             |
| ----------------- | --------------------------------------------------------------------------------------- | --------------------------------------- |
| Gateway forwarder | `DiscordAdapter.startGatewayListener` opens a WS → POSTs every event to the webhook URL | `/api/agent/messenger/webhooks/discord` |
| OAuth2 install    | URL Generator (built dynamically by the LinkModal, no callback)                         | (no callback handler, see below)        |
| Interactions URL  | **Intentionally left blank**                                                            | n/a                                     |

There is no equivalent of Slack's OAuth redirect: the "Add to Server" flow ends inside Discord's UI and never bounces back to LobeHub. The user manually opens the bot DM after the invite — no callback to write.

## Bot permissions rationale

The OAuth2 install URL requests `bot + applications.commands` scopes, plus permissions bitfield `309237763136`. Decoded:

| Bit                                         | Why                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Add Reactions` (`64`)                      | Inline feedback emoji on the user's message (👀 "processing" → ✅ done) — same UX as Slack    |
| `View Channels` (`1024`)                    | Required for the bot to receive any channel-scoped event                                      |
| `Send Messages` (`2048`)                    | Reply in DMs and channels                                                                     |
| `Embed Links` (`16384`)                     | URL previews and embeds in bot replies                                                        |
| `Attach Files` (`32768`)                    | Send file/image attachments back (e.g. when a vision/image-gen agent produces an output file) |
| `Read Message History` (`65536`)            | Read prior messages in a channel/thread for context when replying to an @-mention             |
| `Create Public Threads` (`34359738368`)     | Spawn a thread to keep an agent's reply chain off the parent channel                          |
| `Send Messages in Threads` (`274877906944`) | Replies inside Discord-side threads (auto-created when a user @-mentions the bot in a guild)  |

Sum check: `64 + 1024 + 2048 + 16384 + 32768 + 65536 + 34359738368 + 274877906944 = 309237763136`.

> **Aligned with the per-agent Discord channel docs** (`docs/usage/channels/discord.zh-CN.mdx`). Both products request the same Discord-side surface so users see one consent dialog regardless of which path they came from, and so we can ship channel / @-mention support later without re-prompting consent.

Slash commands UX (LOBE-8489 follow-up): the `applications.commands` scope is **already requested at install time** so it's a no-op once handlers land — slash commands appear automatically once registered via `DiscordApi.registerCommands`.

## Slash commands

**v1 does NOT register Discord global slash commands** — the `MessengerRouter.loadBot` flow skips `client.registerBotCommands(...)` for `creds.platform === 'discord'` so the commands don't appear in Discord autocomplete without a handler attached.

Users invoke commands by typing them as plain text in the DM:

| Command   | What it does                                                                                 |
| --------- | -------------------------------------------------------------------------------------------- |
| `/start`  | Re-issue the link prompt (e.g. to switch the LobeHub account this Discord user is bound to). |
| `/agents` | List the user's agents, switch active via `/agents <n>`.                                     |
| `/new`    | Start a new conversation (clear the cached topic for the user's bot DM).                     |
| `/stop`   | Stop the currently-running agent execution.                                                  |
| `/help`   | Show the command list.                                                                       |

`MessengerRouter.parseCommand` matches the leading `/cmd` regardless of platform, so the text path works in DMs unchanged. LOBE-8489 will add Discord-native slash registration + `bot.onSlashCommand` handlers so the commands also surface in Discord autocomplete.

## DM delivery limits

Discord enforces consent on bot-initiated DMs:

- A bot may DM a user only if that user **shares at least one guild with the bot**, or has previously DM'd the bot.
- A user may also have **Allow direct messages from server members** disabled per guild, which blocks the bot.

`MessengerDiscordBinder.notifyLinkSuccess` calls `POST /users/@me/channels` to open the DM channel. When Discord refuses (`Cannot send messages to this user`), the binder logs and swallows so a single bad recipient doesn't crash the link confirmation flow — but the user won't get the success ping. This is fine UX-wise because the verify-im success page already confirms binding visually.

If a self-hoster's users keep missing the success DM, the typical cause is: bot was added to a server the user is no longer a member of. Re-invite to a shared server and ask the user to DM the bot once.

## Troubleshooting

- **Bot is invited but DMs do nothing**: check dc-center → System Bots → Discord row → live status. `disconnected` / `error` → click **Force Reconnect**. `not registered` → cron hasn't synced yet (wait \~10min on Vercel) or row is `enabled=false`. Then check the lobehub-dev log for `discord gateway listener started` (in-process path) or `discord registered with MessageGateway` (Worker path).
- **`messenger:config: lookup failed for platform=discord`** in lobehub-dev logs: row exists but credentials can't be decrypted. Most likely `KEY_VAULTS_SECRET` differs between dc-center (which encrypted) and lobehub-dev (which is reading). Make them match and restart lobehub-dev to clear the 30s config cache.
- **Gateway connects but slash commands return "interaction failed"**: the bot was invited with `applications.commands` scope but you also configured an Interactions Endpoint URL in the Developer Portal — Discord then routes interactions to that URL instead of the Gateway, bypassing our handlers. **Clear the Interactions Endpoint URL** field and reload the bot.
- **`Cannot send messages to this user` from `notifyLinkSuccess`**: the user has DMs disabled, doesn't share a guild with the bot, or has blocked the bot. Re-invite the bot to a shared server and ask the user to send any message to the bot first.
- **Slash commands don't show up in Discord autocomplete**: expected in v1 — see [Slash commands](#slash-commands). LOBE-8489 ships native registration.
- **`MESSAGE CONTENT INTENT` toggle is missing on the Bot page**: Discord hides the toggle once your App reaches 100+ guild installs and requires intent verification. Until then, any developer can flip it freely. For the Cloud-distributed App, intent verification is handled by the LobeHub team.
- **`messenger.discord.connectModal.notConfigured` shown in the UI**: the Discord row in dc-center is missing or has `enabled=false`; or the credentials JSON in DB lacks `applicationId` / `botToken` / `publicKey`. Open dc-center → System Bots → fix the row → wait \~30s for lobehub-dev's config cache to refresh.
