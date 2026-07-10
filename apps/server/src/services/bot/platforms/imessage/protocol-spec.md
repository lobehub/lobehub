# iMessage via BlueBubbles Desktop Bridge – Bot Integration Notes

Authoritative references:

- BlueBubbles REST API and webhooks: <https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks>
- BlueBubbles Server source: <https://github.com/BlueBubblesApp/bluebubbles-server>

## Architecture

LobeHub does not speak to Apple's iMessage service directly. Operators host
BlueBubbles Server on a Mac signed into Messages. The LobeHub Desktop app runs
a loopback webhook bridge on that Mac and keeps the BlueBubbles REST URL and
password local.

```text
iMessage -> macOS Messages -> BlueBubbles -> 127.0.0.1 LobeHub Desktop bridge
Desktop bridge -> /api/agent/webhooks/imessage/:applicationId -> LobeHub bot router
LobeHub bot reply -> Device Gateway tool call -> Desktop bridge -> BlueBubbles REST API
```

## Credentials

Cloud bot provider:

| Field             | Source                             | Notes                                                                                                    |
| ----------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `applicationId`   | Operator-chosen LobeHub identifier | Shared by the cloud provider and Desktop bridge.                                                         |
| `desktopDeviceId` | LobeHub Desktop Gateway settings   | Identifies the Desktop device that can reach BlueBubbles locally.                                        |
| `webhookSecret`   | Operator-generated                 | Desktop forwards BlueBubbles events to LobeHub with `?secret=<value>` because BlueBubbles does not sign. |

Desktop-only bridge config:

| Field                  | Source                      | Notes                                                          |
| ---------------------- | --------------------------- | -------------------------------------------------------------- |
| `applicationId`        | Same as cloud provider      | Selects which cloud bot receives forwarded events.             |
| `blueBubblesServerUrl` | Local BlueBubbles base URL  | Usually `http://127.0.0.1:<port>`. No public URL is required.  |
| `blueBubblesPassword`  | BlueBubbles Server password | Stored only in Desktop local settings.                         |
| `webhookSecret`        | Same as cloud provider      | Used by the Desktop loopback URL and the cloud forwarding URL. |

## Webhook lifecycle

1. Desktop starts a loopback HTTP server bound to `127.0.0.1`.
2. Desktop registers a BlueBubbles `new-message` webhook pointing to
   `http://127.0.0.1:<port>/webhooks/bluebubbles/:applicationId?secret=...`.
3. BlueBubbles posts `{ "type": "new-message", "data": <message> }` locally.
4. Desktop enriches the payload with
   `GET /api/v1/message/:guid?with=chats,attachments` when possible.
5. Desktop forwards the event to
   `/api/agent/webhooks/imessage/:applicationId?secret=...`.
6. The Chat SDK adapter ignores `isFromMe` messages to avoid loops and
   dispatches inbound messages as `imessage:<chatGuid>`.

## Outbound lifecycle

The server never calls BlueBubbles directly. It uses the existing Device Gateway
tool-call channel to ask the configured Desktop device to execute iMessage
bridge actions:

- `imessage.ping`
- `imessage.sendText`
- `imessage.sendAttachment`
- `imessage.startTyping`
- `imessage.downloadAttachment`
- `imessage.getChat`
- `imessage.getChatMessages`
- `imessage.queryMessages`
- `imessage.queryChats`

## Capabilities

- Text reply: Desktop calls `POST /api/v1/message/text`
- Attachment reply: Desktop calls `POST /api/v1/message/attachment`
- Attachment download: Desktop calls `GET /api/v1/attachment/:guid/download`
- Read recent messages: Desktop calls `GET /api/v1/chat/:guid/message`
- Search messages: Desktop calls `POST /api/v1/message/query`
- Channel metadata: Desktop calls `GET /api/v1/chat/:guid`

Typing indicators call `POST /api/v1/chat/:guid/typing`, which requires
BlueBubbles Private API. Failures are logged and ignored.

## Limitations

- LobeHub Desktop must stay online for inbound forwarding and outbound replies.
- iMessage has no general bot mention primitive. Group wake behavior relies on
  watch keywords and group policy, not native `@bot` mentions.
- Message editing, deleting, reactions, pins, polls, and threads are not
  exposed as LobeHub bot capabilities for iMessage.
- BlueBubbles advanced send features may require the Private API / SIP changes
  on the Mac. LobeHub's basic text and attachment path uses AppleScript by
  default.
