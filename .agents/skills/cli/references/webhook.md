# Webhook Commands (`lh webhook`, alias `lh webhooks`)

Manage inbound webhooks: the rows of the `inbound_webhooks` table the Web shows on Agent Profile → Webhook and Settings → Automations.

**Source**: `apps/cli/src/commands/webhook.ts` (registration and actions), `webhook/input.ts` (flag → TRPC input rules), `webhook/format.ts` (table, details, curl usage, error texts)

**Server**: TRPC `inboundWebhook.*` (`apps/server/src/routers/lambda/inboundWebhook.ts`); the rules live in `apps/server/src/services/inboundWebhook/manage.ts`. The CLI never changes them: its local checks only give a clearer message before the server would reject.

Two kinds share one table:

- `generic`: a custom webhook URL called with `Authorization: Bearer <key>`. Full management here.
- `mcp_events`: an MCP Events subscription an agent made in a conversation. View, rename (`edit --name`), `check` and `delete`; creating one stays a conversation action.

## Commands

| Command                                                                                                           | Procedure            | Notes                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------- |
| `lh webhook list [--agent <id>] [--kind generic\|mcp_events] [--json [fields]]`                                   | `list`               | `--kind` filters locally                                                  |
| `lh webhook view <id> [--json [fields]]`                                                                          | `get`                | Endpoint, curl usage, `?thread=`, `Idempotency-Key`, last error           |
| `lh webhook create --agent <id> [settings] [--json [fields]]`                                                     | `create`             | Prints the key once; `--json` adds it as `secret`                         |
| `lh webhook edit <id> [settings] [--no-name] [--no-instructions] [--no-topic] [--no-auto-approve] [--no-channel]` | `update`             | Only given flags change; `--no-channel` sends `delivery: null`            |
| `lh webhook pause <id>` / `resume <id>`                                                                           | `update({ paused })` | Custom webhooks only                                                      |
| `lh webhook rotate-key <id> [--yes] [--json [fields]]`                                                            | `rotateToken`        | Confirms: the old key stops working at once                               |
| `lh webhook test <id>`                                                                                            | `sendTest`           | Refuses a paused webhook; non-accepted result exits 1                     |
| `lh webhook calls <id> [-L <n>] [--all] [--json [fields]]`                                                        | `listDeliveries`     | Follows `nextCursor` until the limit (default 20) or the end with `--all` |
| `lh webhook check <id>`                                                                                           | `check`              | MCP Events only                                                           |
| `lh webhook delete <id> [--yes]`                                                                                  | `delete`             | Confirms; for MCP Events it also ends the subscription on the MCP server  |

Settings flags (`create` and `edit`): `--name`, `--instructions`, `--topic-mode new|reuse`, `--topic <tpc_id>` (implies `reuse`), `--auto-approve`, `--channel <chn_id>`, `--thread <cht_id>`.

## Rules enforced locally

- Ids must be uuids (otherwise the server answers with a raw validation error).
- `--channel` needs auto-approval: on `create` the `--auto-approve` flag, on `edit` the flag or the row's current value. Turning auto-approval off while the row still posts to a Channel needs `--no-channel`.
- `--thread` needs a Channel: on `create` `--channel`; on `edit` the flag or the row's current delivery. A `cht_` id passed as `--channel` is rejected with a hint.
- `--topic` with `--topic-mode new` is rejected (the server would silently drop the topic).
- `pause`, `resume`, `rotate-key` and `test` on an `mcp_events` row, `edit` with anything but `--name`/`--no-name` on one, and `check` on a `generic` row, fail with a message naming what works instead.
