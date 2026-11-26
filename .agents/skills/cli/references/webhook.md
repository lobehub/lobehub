# Webhook Commands (`lh webhook`, alias `lh webhooks`)

Manage custom webhooks: the `generic` rows of the `inbound_webhooks` table, shown on the Web under Agent Profile → Webhook.

**Source**: `apps/cli/src/commands/webhook.ts` (registration and actions), `webhook/input.ts` (flag → TRPC input rules), `webhook/format.ts` (table, details, curl usage, call log), `webhook/shared.ts` (shared with `lh automation`: id check, kind guards, error texts, status and target formatting)

**Server**: TRPC `inboundWebhook.*` (`apps/server/src/routers/lambda/inboundWebhook.ts`); the rules live in `apps/server/src/services/inboundWebhook/manage.ts`. The CLI never changes them: its local checks only give a clearer message before the server would reject.

The same table and router also hold MCP Events subscriptions (`mcp_events`). Those are automations, not webhooks, and have their own group: `lh automation` (`references/automation.md`). Every `lh webhook` command that takes an id refuses an `mcp_events` row with "… is an automation (MCP Events subscription) …" and the `lh automation` command to use.

## Name and identifier

- `name`: for people, freely renamed (`edit --name`, cleared with `--no-name`; the webhook then shows its identifier).
- `identifier`: how the agent knows the webhook (`<webhookEvent identifier=…>`). The server makes it from the name on create (`genericWebhookIdentifierFromName`, `webhook` when the name gives none) and never changes it. The CLI shows it in `list`, `view`, `create` and `edit` output and has no flag to set it.

## Commands

| Command                                                                                                           | Procedure                    | Notes                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `lh webhook list [--agent <id>] [--json [fields]]`                                                                | `list({ kind: 'generic' })`  | The server filters by kind and agent                                      |
| `lh webhook view <id> [--json [fields]]`                                                                          | `get`                        | Name, identifier, endpoint, curl usage, `?thread=`, `Idempotency-Key`     |
| `lh webhook create --agent <id> [settings] [--json [fields]]`                                                     | `create`                     | Prints the identifier and the key once; `--json` adds it as `secret`      |
| `lh webhook edit <id> [settings] [--no-name] [--no-instructions] [--no-topic] [--no-auto-approve] [--no-channel]` | `update`                     | Only given flags change; `--no-channel` sends `delivery: null`            |
| `lh webhook pause <id>` / `resume <id>`                                                                           | `update({ paused })`         |                                                                           |
| `lh webhook rotate-key <id> [--yes] [--json [fields]]`                                                            | `rotateToken`                | Confirms: the old key stops working at once                               |
| `lh webhook test <id>`                                                                                            | `sendTest`                   | Refuses a paused webhook; non-accepted result exits 1                     |
| `lh webhook calls <id> [-L <n>] [--all] [--json [fields]]`                                                        | `get`, then `listDeliveries` | Follows `nextCursor` until the limit (default 20) or the end with `--all` |
| `lh webhook delete <id> [--yes]`                                                                                  | `delete`                     | Confirms: the URL stops working at once                                   |

Settings flags (`create` and `edit`): `--name`, `--instructions`, `--topic-mode new|reuse`, `--topic <tpc_id>` (implies `reuse`), `--auto-approve`, `--channel <chn_id>`, `--thread <cht_id>`.

## Rules enforced locally

- Ids must be uuids (otherwise the server answers with a raw validation error).
- An `mcp_events` id is refused before any change, pointing at `lh automation view|rename|delete <id>`.
- `--channel` needs auto-approval: on `create` the `--auto-approve` flag, on `edit` the flag or the row's current value. Turning auto-approval off while the row still posts to a Channel needs `--no-channel`.
- `--thread` needs a Channel: on `create` `--channel`; on `edit` the flag or the row's current delivery. A `cht_` id passed as `--channel` is rejected with a hint.
- `--topic` with `--topic-mode new` is rejected (the server would silently drop the topic).
