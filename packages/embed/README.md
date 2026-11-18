# @lobechat/embed

Put a shared LobeHub Agent on any website: a chat button in the corner that opens the Agent's
conversation in a panel. Behind the `agent_embed` feature flag, off by default.

- `src/auto.ts` — the hosted `<script>` loader, served by the app at `/embed.js`
  (`bun run build:embed` writes `public/embed.js`; `dev` and `build` run it).
- `src/loader.ts` — `createLobeHubEmbed(options)`, the same loader as an ES module.
- `src/protocol.ts` — the `postMessage` protocol between the loader and the embedded page.
- `src/origin.ts` — what counts as an allowed website, shared with the server that turns the
  allowlist into the page's `frame-ancestors` header.
- `examples/index.html` — a host page with theme controls and an event log.

## How it fits together

1. The creator shares an Agent by link and lists the websites allowed to embed it
   (`shareConfig.embedAllowedOrigins`, edited in the share settings).
2. The website adds the script. The launcher opens an iframe on
   `<LobeHub origin>/embed/agent/<share slug>`.
3. The server answers that page with `Content-Security-Policy: frame-ancestors <allowlist>`.
   Every other route keeps `X-Frame-Options: DENY` / `frame-ancestors 'none'`, and the embed page
   itself falls back to `'none'` when the share is paused, the allowlist is empty, the creator is
   outside the `agent_embed` rollout, or the deployment has no Agent Share. The browser refuses to
   render the conversation on any other website.
4. The conversation is an ordinary Agent Share visitor conversation: the visitor signs in, every run
   uses the share's `shareChat` path and counts against the same caps (topics per visitor, turns per
   topic, monthly spend, file storage).

## Usage

```html
<script
  src="https://app.lobehub.com/embed.js"
  data-agent="my-agent"
  data-theme="auto"
  data-position="right"
  async
></script>
```

| Attribute           | Meaning                                                      |
| ------------------- | ------------------------------------------------------------ |
| `data-agent`        | Share slug or share id. Required for the automatic launcher. |
| `data-host`         | LobeHub origin. Defaults to the script's own origin.         |
| `data-theme`        | `light`, `dark` or `auto` (follows the visitor's system).    |
| `data-position`     | `right` (default) or `left`.                                 |
| `data-open`         | `true` opens the panel on load.                              |
| `data-locale`       | UI language, e.g. `zh-CN`.                                   |
| `data-button-label` | Accessible name of the launcher.                             |

Without `data-agent`, call it yourself:

```js
const embed = window.LobeHubEmbed.init({ agent: 'my-agent', theme: 'dark' });
embed.on('messageSent', ({ topicId }) => analytics.track('assistant_message', { topicId }));
embed.setTheme('light');
embed.open(); // close(), toggle(), destroy()
```

## Protocol

Every message is `{ source: 'lobehub-embed', version: 1, type, ... }`.

| Direction    | `type`         | Fields     | When                                               |
| ------------ | -------------- | ---------- | -------------------------------------------------- |
| host → embed | `init`         | `theme?`   | Repeated after the iframe loads until `ready`.     |
| host → embed | `setTheme`     | `theme`    | `embed.setTheme()`.                                |
| embed → host | `ready`        |            | The conversation took the host's origin.           |
| embed → host | `close`        |            | The visitor closed the panel from inside.          |
| embed → host | `messageSent`  | `topicId?` | The visitor sent a message (no content is shared). |
| embed → host | `topicCreated` | `topicId`  | The first message opened a new conversation.       |

The embedded page learns the host's origin from the first `init` and posts only to that origin.
The loader accepts messages only from its own iframe on the LobeHub origin.

## Signing in

Visitors need a LobeHub account, as on the share link. Inside the panel, sign-in opens in a new
window (the sign-in page itself cannot be framed); the panel picks the session up afterwards.

**Known limitation — cross-site hosts.** The session cookie is `SameSite=Lax`, and browsers never
send a Lax cookie to a frame whose top-level site differs. So a signed-in conversation works only
where the host website is same-site with the LobeHub origin (for example `docs.example.com`
embedding a LobeHub deployment on `chat.example.com`, or `localhost` ports in development). On any
other website the panel keeps asking the visitor to sign in. Supporting arbitrary websites needs a
cross-site session (the Storage Access API with a `SameSite=None; Secure` cookie, or a scoped token
the sign-in window hands to the panel) and is not part of this version.

## Try it locally

Agent Share needs a deployment that supports it (LobeHub Cloud); on other deployments the embed
page answers `frame-ancestors 'none'` and shows that embedded chat is unavailable.

```bash
FEATURE_FLAGS=+agent_embed bun run dev        # app on http://localhost:3010
npx serve packages/embed/examples -l 5555     # host page on http://localhost:5555
```

Add `http://localhost:5555` to the share's allowed websites, then open
`http://localhost:5555/?host=http://localhost:3010&agent=<share slug>`.
