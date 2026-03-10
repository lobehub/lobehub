---
name: chat-sdk
description: >
  Build multi-platform chat bots with Chat SDK (`chat` npm package). Use when developers want to
  (1) Build a Slack, Teams, Google Chat, Discord, GitHub, or Linear bot,
  (2) Use the Chat SDK to handle mentions, messages, reactions, slash commands, cards, modals, or streaming,
  (3) Set up webhook handlers for chat platforms,
  (4) Send interactive cards or stream AI responses to chat platforms.
  Triggers on "chat sdk", "chat bot", "slack bot", "teams bot", "discord bot", "@chat-adapter",
  building bots that work across multiple chat platforms.
---

# Chat SDK

Unified TypeScript SDK for building chat bots across Slack, Teams, Google Chat, Discord, GitHub, and Linear. Write bot logic once, deploy everywhere.

## Critical: Read the bundled docs

The `chat` package ships with full documentation in `node_modules/chat/docs/` and TypeScript source types. **Always read these before writing code:**

```
node_modules/chat/docs/           # Full documentation (MDX files)
node_modules/chat/dist/           # Built types (.d.ts files)
```

Key docs to read based on task:

- `docs/getting-started.mdx` — setup guides
- `docs/usage.mdx` — event handlers, threads, messages, channels
- `docs/streaming.mdx` — AI streaming with AI SDK
- `docs/cards.mdx` — JSX interactive cards
- `docs/actions.mdx` — button/dropdown handlers
- `docs/modals.mdx` — form dialogs (Slack only)
- `docs/adapters/*.mdx` — platform-specific adapter setup
- `docs/state/*.mdx` — state adapter config (Redis, ioredis, memory)

Also read the TypeScript types from `node_modules/chat/dist/` to understand the full API surface.

## Quick start

```typescript
import { Chat } from 'chat';
import { createSlackAdapter } from '@chat-adapter/slack';
import { createRedisState } from '@chat-adapter/state-redis';

const bot = new Chat({
  userName: 'mybot',
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    }),
  },
  state: createRedisState({ url: process.env.REDIS_URL! }),
});

bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post("Hello! I'm listening to this thread.");
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

## Core concepts

- **Chat** — main entry point, coordinates adapters and routes events
- **Adapters** — platform-specific (Slack, Teams, GChat, Discord, GitHub, Linear)
- **State** — pluggable persistence (Redis for prod, memory for dev)
- **Thread** — conversation thread with `post()`, `subscribe()`, `startTyping()`
- **Message** — normalized format with `text`, `formatted` (mdast AST), `raw`
- **Channel** — container for threads, supports listing and posting

## Event handlers

| Handler                    | Trigger                                           |
| -------------------------- | ------------------------------------------------- |
| `onNewMention`             | Bot @-mentioned in unsubscribed thread            |
| `onSubscribedMessage`      | Any message in subscribed thread                  |
| `onNewMessage(regex)`      | Messages matching pattern in unsubscribed threads |
| `onSlashCommand("/cmd")`   | Slash command invocations                         |
| `onReaction(emojis)`       | Emoji reactions added/removed                     |
| `onAction(actionId)`       | Button clicks and dropdown selections             |
| `onAssistantThreadStarted` | Slack Assistants API thread opened                |
| `onAppHomeOpened`          | Slack App Home tab opened                         |

## Streaming

Pass any `AsyncIterable<string>` to `thread.post()`. Works with AI SDK's `textStream`:

```typescript
import { ToolLoopAgent } from 'ai';
const agent = new ToolLoopAgent({ model: 'anthropic/claude-4.5-sonnet' });

bot.onNewMention(async (thread, message) => {
  const result = await agent.stream({ prompt: message.text });
  await thread.post(result.textStream);
});
```

## Cards (JSX)

Set `jsxImportSource: "chat"` in tsconfig. Components: `Card`, `CardText`, `Button`, `Actions`, `Fields`, `Field`, `Select`, `SelectOption`, `Image`, `Divider`, `LinkButton`, `Section`, `RadioSelect`.

```tsx
await thread.post(
  <Card title="Order #1234">
    <CardText>Your order has been received!</CardText>
    <Actions>
      <Button id="approve" style="primary">
        Approve
      </Button>
      <Button id="reject" style="danger">
        Reject
      </Button>
    </Actions>
  </Card>,
);
```

## Packages

| Package                       | Purpose                       |
| ----------------------------- | ----------------------------- |
| `chat`                        | Core SDK                      |
| `@chat-adapter/slack`         | Slack                         |
| `@chat-adapter/teams`         | Microsoft Teams               |
| `@chat-adapter/gchat`         | Google Chat                   |
| `@chat-adapter/discord`       | Discord                       |
| `@chat-adapter/github`        | GitHub Issues                 |
| `@chat-adapter/linear`        | Linear Issues                 |
| `@chat-adapter/state-redis`   | Redis state (production)      |
| `@chat-adapter/state-ioredis` | ioredis state (alternative)   |
| `@chat-adapter/state-memory`  | In-memory state (development) |

## Changesets (Release Flow)

This monorepo uses [Changesets](https://github.com/changesets/changesets) for versioning and changelogs. Every PR that changes a package's behavior must include a changeset.

```bash
pnpm changeset
# → select affected package(s) (e.g. @chat-adapter/slack, chat)
# → choose bump type: patch (fixes), minor (features), major (breaking)
# → write a short summary for the CHANGELOG
```

This creates a file in `.changeset/` — commit it with the PR. When merged to `main`, the Changesets GitHub Action opens a "Version Packages" PR to bump versions and update CHANGELOGs. Merging that PR publishes to npm.

## Webhook setup

Each adapter exposes a webhook handler via `bot.webhooks.{platform}`. Wire these to your HTTP framework's routes (e.g. Next.js API routes, Hono, Express).
