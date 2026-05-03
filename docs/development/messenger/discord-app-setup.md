# Discord App setup for the LobeHub Messenger

This file explains how to bring up a Discord App that connects to a LobeHub deployment as the Messenger bot. It mirrors `slack-app-setup.md` so the two surfaces stay legible side-by-side.

## What you get

One Discord App per environment:

- **Cloud production** — managed by LobeHub, listed wherever Discord apps surface.
- **Cloud staging / dev** — internal, points at the dev domain.
- **Self-hosted** — your own App ID, points at your domain.

Each App stores its own credentials (`LOBE_DISCORD_APPLICATION_ID` / `LOBE_DISCORD_BOT_TOKEN` / `LOBE_DISCORD_PUBLIC_KEY` / `LOBE_DISCORD_BOT_USERNAME`). Unlike Slack, Discord does **not** issue per-guild bot tokens — the same App-level Bot Token works in every guild the bot is invited to, so there is no OAuth callback or per-tenant install row.

## Prerequisites

- A LobeHub deployment reachable on a stable HTTPS URL (`APP_URL`). For local dev use a tunnel — `cloudflared tunnel --url http://localhost:3010`, `ngrok http 3010`, etc. — and set both `APP_URL` and `WEBHOOK_PUBLIC_URL` to the tunnel URL.
- A Discord account that can create applications at <https://discord.com/developers/applications>.
- A Discord server (guild) where you have **Manage Server** permission, to invite the bot for testing.

> **Local dev tip**: tunnel hostnames change per restart. Discord's Interactions Endpoint URL must be updated every time, and Discord re-runs its PING signature check the moment you save — if the URL is stale or the public key is wrong, the save button rejects with `Validation failed`. A stable named tunnel avoids this churn.

## First-time setup (per environment)

1. **Create the App** — Discord Developer Portal → **New Application**, give it a name, accept the developer ToS.
2. **Add a Bot user** — left sidebar → **Bot**. Discord auto-creates a bot user matching the Application name. Optionally rename it (this is what users see).
3. **Enable required Privileged Gateway Intent** — same Bot page → **Privileged Gateway Intents** → toggle **MESSAGE CONTENT INTENT** on. The messenger reads the user's DM text (verify-im triggers, `parseCommand` for `/agents`, etc.) and Discord blocks `content` field access without this opt-in. (`PRESENCE` and `SERVER MEMBERS` intents are NOT needed for v1.)
4. **Copy credentials**:
   - **General Information** page → **Application ID** → `LOBE_DISCORD_APPLICATION_ID` (this also doubles as the bot user ID)
   - **General Information** page → **Public Key** → `LOBE_DISCORD_PUBLIC_KEY`
   - **Bot** page → **Reset Token** → copy the new token → `LOBE_DISCORD_BOT_TOKEN` (the old token is invalidated immediately, so do this when you're ready to wire the env)
   - Optional: bot username → `LOBE_DISCORD_BOT_USERNAME` (used in UI strings only)
5. **Set the Interactions Endpoint URL** — General Information → **Interactions Endpoint URL**:
   ```
   <APP_URL>/api/agent/messenger/webhooks/discord
   ```
   On save, Discord immediately POSTs a `type: 1` PING signed with your public key. `@chat-adapter/discord` verifies the Ed25519 signature and replies `type: 1` PONG; if the save button stays red, see [Troubleshooting](#troubleshooting).
6. **Set env vars** in your LobeHub deployment (Cloud secrets manager, `.env`, etc.).
7. **Restart** LobeHub so the new env is picked up.
8. **Invite the bot to a guild** — sign into LobeHub web → Messenger settings → click **Discord** → **Add to Discord server**. The OAuth2 install URL (`bot` + `applications.commands` scope, permission bitfield `274877942784`) is built by `buildDiscordInviteUrl()`; it opens Discord's "Add to Server" picker.
9. **Smoke test** — DM the bot in Discord (its profile is reachable from any shared guild's member list, or from the **Open in Discord** link in LobeHub's LinkModal). You should get the link prompt; click the verify-im URL, finish account binding, then send `/agents` as plain text in the DM — the bot replies with your agent list.

## Updating the App

Discord stores App config server-side, so editing this doc doesn't propagate. To roll out a change:

- Settings (intents, scopes, redirect URLs) → edit in the Developer Portal directly.
- Bot token rotation → **Reset Token**, update env, restart LobeHub.
- Public key (only changes if Discord rotates it for you, very rare) → update env, restart.

> **Re-invite required when scopes change.** If you later add `applications.commands` (e.g. for slash commands; see LOBE-8489) to an App that was originally invited with only `bot`, existing guilds need to re-run the invite URL to grant the new scope. The bot token itself stays valid.

## Discord URL surfaces

Compared to Slack's six surfaces, Discord has just one — Discord routes everything (PING, slash commands, message components, modal submits) to a single Interactions Endpoint URL:

| Surface        | Console location                                            | Where it lives in this repo             |
| -------------- | ----------------------------------------------------------- | --------------------------------------- |
| Interactions   | General Information → Interactions Endpoint URL             | `/api/agent/messenger/webhooks/discord` |
| OAuth2 install | OAuth2 → URL Generator (built dynamically by the LinkModal) | (no callback handler, see below)        |

There is no equivalent of Slack's OAuth redirect: the "Add to Server" flow ends inside Discord's UI and never bounces back to LobeHub. The user manually opens the bot DM after the invite — no callback to write.

## Bot permissions rationale

The OAuth2 install URL requests `bot + applications.commands` scopes, plus permissions bitfield `274877942784`. Decoded:

| Bit                                         | Why                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `View Channel` (`1024`)                     | Required for the bot to receive any channel-scoped events (forward-looking; v1 is DM-only)          |
| `Send Messages` (`2048`)                    | Reply in DMs and any future channel surface                                                         |
| `Send Messages in Threads` (`274877906944`) | DM-bot replies inside Discord-side threads (auto-created when a user @-mentions the bot in a guild) |

> **Why narrower than the channel-bot docs at `docs/usage/channels/discord.zh-CN.mdx`?** The two products are different. The channel docs cover a per-agent bot a user installs themselves and may use for channel @mentions, reactions, polls — needs the full set. The messenger app is the LobeHub-distributed App, DM-only in v1, so we ask for the minimum that delivers the feature.

Future scope additions (track separately):

- **Channel support** (parallel to Slack PR3): no new OAuth scopes needed, but bot permissions bitfield grows to include `Read Message History`, `Add Reactions`, `Use External Emojis`.
- **Slash commands UX** (LOBE-8489): the `applications.commands` scope is **already requested at install time** so this is a no-op once handlers land — slash commands appear automatically once registered via `DiscordApi.registerCommands`.

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

- **PING validation fails on save (`Validation failed: interactions endpoint URL ...`)**: the most common causes are (a) `LOBE_DISCORD_PUBLIC_KEY` doesn't match the App's Public Key (typo / wrong env), (b) the URL isn't reachable from Discord's edge (tunnel down, firewall), (c) the LobeHub server is up but `MessengerRouter.getWebhookHandler('discord')` returns 404 because env isn't loaded yet (restart after setting env). Check the server logs for the Ed25519 verification error from `@chat-adapter/discord`.
- **Bot is invited but DMs do nothing**: confirm `LOBE_DISCORD_BOT_TOKEN` is set and matches the App. The interactions endpoint must also be configured — without it, Discord drops every interaction silently and you'll only see the message in the Discord UI without any bot response.
- **`Cannot send messages to this user` from `notifyLinkSuccess`**: the user has DMs disabled, doesn't share a guild with the bot, or has blocked the bot. Re-invite the bot to a shared server and ask the user to send any message to the bot first.
- **Slash commands don't show up in Discord autocomplete**: expected in v1 — see [Slash commands](#slash-commands). LOBE-8489 ships native registration.
- **`MESSAGE CONTENT INTENT` toggle is missing on the Bot page**: Discord hides the toggle once your App reaches 100+ guild installs and requires intent verification. Until then, any developer can flip it freely. For the Cloud-distributed App, intent verification is handled by the LobeHub team.
- **After tunnel restart, the Interactions Endpoint URL save button refuses to turn green**: the new tunnel hostname is likely correct but Discord cached the old PING failure for \~30s. Wait, then re-save with the new URL.
- **`messenger.discord.connectModal.notConfigured` shown in the UI**: `LOBE_DISCORD_APPLICATION_ID` (or one of the other three required vars) is missing in the running deployment — the TRPC `availablePlatforms` query strips the `appId` and the LinkModal falls into the not-configured branch.
