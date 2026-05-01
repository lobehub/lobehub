# Slack App setup for the LobeHub Messenger

This file explains how to use `slack-app-manifest.yaml` to bring up a Slack App that connects to a LobeHub deployment.

## What you get

One Slack App per environment:

- **Cloud production** — managed by LobeHub, listed on the Slack Marketplace.
- **Cloud staging / dev** — internal, points at the dev domain.
- **Self-hosted** — your own App ID, points at your domain.

Each App stores its own client credentials (`LOBE_SLACK_CLIENT_ID` / `LOBE_SLACK_CLIENT_SECRET` / `LOBE_SLACK_SIGNING_SECRET` / `LOBE_SLACK_APP_ID`); the manifest encodes everything else (scopes, event subscriptions, redirect URLs, App Home toggles).

## Prerequisites

- A LobeHub deployment reachable on a stable HTTPS URL (`APP_URL`). For local dev use a tunnel — `ngrok http 3010`, `cloudflared tunnel`, etc. — and set `WEBHOOK_PUBLIC_URL` to the tunnel URL.
- A Slack workspace where you have admin rights (to create / install Apps).

## First-time setup (per environment)

1. **Edit the manifest** — open `slack-app-manifest.yaml` and replace every occurrence of `https://app.lobehub.com` with your environment's `APP_URL`. The four `request_url` / `redirect_urls` entries must all point at the same domain.
2. **Create the App** — go to <https://api.slack.com/apps>, click **Create New App → From an app manifest**, pick the workspace, paste the YAML, click through.
3. **Copy credentials** — on the App's "Basic Information" page grab:
   - `App ID` → `LOBE_SLACK_APP_ID`
   - `Client ID` → `LOBE_SLACK_CLIENT_ID`
   - `Client Secret` → `LOBE_SLACK_CLIENT_SECRET`
   - `Signing Secret` → `LOBE_SLACK_SIGNING_SECRET`
4. **Set env vars** in your LobeHub deployment (Cloud secrets manager, `.env`, etc.).
5. **Restart** LobeHub so the new env is picked up.
6. **Smoke test** — sign into LobeHub web → Messenger settings → click **Connect Slack** → install into a workspace → confirm the OAuth flow lands on `slack.com/app/open`.

## Updating the manifest

Slack stores the manifest server-side, so editing the YAML file in the repo doesn't propagate by itself. To roll out a change:

- **Manual**: paste the updated YAML into the App console under **App Manifest → Edit**.
- **Programmatic**: use `apps.manifest.update` with an admin token — useful from CI for staging / dev Apps.

Production App changes go through Slack Marketplace re-review for any scope change. Plan ahead.

## Scope rationale

| Scope                  | Why                                                                     |
| ---------------------- | ----------------------------------------------------------------------- |
| `chat:write`           | Post DM responses + the first-time link prompt                          |
| `im:history` `im:read` | Read the user's DM messages so the bot can reply                        |
| `im:write`             | Open the IM channel for `notifyLinkSuccess` after the user binds        |
| `users:read`           | Resolve `slack_user_id` → user profile                                  |
| `users:read.email`     | Pull `email` for the verify-im URL prefill (the user can still edit it) |

PR3 will request `app_mentions:read` (channel mentions), `channels:history` (read context for replies), and `commands` (slash commands). Each scope addition triggers Marketplace re-review — keep PR3 batched.

## Troubleshooting

- **"url_verification" challenge fails on first save**: your webhook URL isn't reachable from Slack, or `LOBE_SLACK_SIGNING_SECRET` doesn't match. Check the LobeHub server logs.
- **OAuth callback 400 "invalid state"**: the install state expired (10-min TTL) or Redis lost it. Restart the install from the LobeHub modal.
- **App installs but DMs do nothing**: check `messenger_installations` has a row for the `team_id`. If yes, the bot token might not have been saved with the right credentials JSON shape — see the OAuth callback logs.
