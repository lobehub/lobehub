---
name: agent-testing-bot
description: >
  Bot-channel end-to-end verification for LobeHub — drives the real native chat
  apps (Discord / Slack / Telegram / WeChat / Lark / QQ / iMessage) via osascript
  or the iMessage bridge, on macOS. Extends the generic agent-testing skill for
  bot surfaces. Triggers on 'test bot', 'bot test', 'test in discord',
  'test in telegram', 'test in slack', 'test in wechat', 'test in weixin',
  'test in lark', 'test in feishu', 'test in qq'.
---

# Agent Testing — Bot Channels (LobeHub project skill)

This skill **extends** the generic `agent-testing` skill (installed alongside at
`../agent-testing/`) to the bot-channel surfaces. It does NOT replace the core
process: the same three phases apply —

```text
PLAN (Steps 0–2) → EXECUTE (Steps 3–6) → FINISH (Step 7)
```

— and the same report + publish pipeline (`result.json` → `report-init.sh` →
`lh acceptance run ingest … --source agent-testing`). Read the generic skill's
`SKILL.md` for target grounding, the living logs, the Phase-1 approval gate, the
report format, and teardown. This file only adds the bot-channel surface.

For LobeHub environment/auth/probe specifics (dev server, seeded account, ports),
the adapter is `.agents/acceptance/PROJECT.md`.

## When this surface applies

| Change scope                                   | Surface                           | Why                                              |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------ |
| **Bot channels** (Discord / WeChat / Lark / …) | Native app via osascript / bridge | Only way to exercise the real channel end-to-end |

Route here only when the behavior under test is a bot channel. For CLI / Web /
Electron changes, use the generic skill's surfaces.

## Platforms

Each platform folder has an `index.md` (activation, navigation, send-message,
verification snippets) and a `test-<platform>-bot.sh` driver.

| Platform      | Guide                                    | Quick switcher        |
| ------------- | ---------------------------------------- | --------------------- |
| Discord       | [discord/index.md](./discord/index.md)   | `Cmd+K`               |
| Slack         | [slack/index.md](./slack/index.md)       | `Cmd+K`               |
| Telegram      | [telegram/index.md](./telegram/index.md) | `Cmd+F`               |
| WeChat / 微信 | [wechat/index.md](./wechat/index.md)     | `Cmd+F`               |
| Lark / 飞书   | [lark/index.md](./lark/index.md)         | `Cmd+K`               |
| QQ            | [qq/index.md](./qq/index.md)             | `Cmd+F`               |
| iMessage      | [imessage/index.md](./imessage/index.md) | bridge (no osascript) |

## Shared driver contract

Every osascript platform script shares one interface:

```bash
./$PLATFORM/test-$PLATFORM-bot.sh $CHANNEL_OR_CONTACT $MESSAGE [$WAIT_SECONDS] [$SCREENSHOT_PATH]
```

The script activates the app, navigates to the channel/contact, sends the
message, waits, and screenshots the result window (via the generic skill's
`../agent-testing/scripts/capture-app-window.sh`). iMessage is the exception: it
uses a BlueBubbles bridge, not osascript — see [imessage/index.md](./imessage/index.md).

## osascript prerequisites

The osascript platforms drive real macOS apps (activate, keystroke, click, read
accessibility, screenshot). Read the generic skill's general macOS-automation
reference before a first bot run:
[../agent-testing/references/osascript.md](../agent-testing/references/osascript.md).
The target native app must already be running and logged in.

## Screen-recording gate (macOS-only)

Bot evidence is captured with OS-level `screencapture` (through
`capture-app-window.sh`), NOT CDP — so it comes out **entirely black** when macOS
Screen Recording (TCC) permission is missing OR the display is asleep / locked /
on a screensaver. Gate BEFORE any bot capture:

```bash
./.agents/skills/agent-testing/scripts/check-screen-recording.sh # exit 0 = OS capture will work
```

Keep the display awake for the whole capture session (`caffeinate -dimsu &`, kill
when done). Because this surface depends on OS capture and native macOS apps,
**bot channels are macOS-only — they do not run headless / in cloud.**
