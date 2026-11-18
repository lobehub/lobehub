# Automation Commands (`lh automation`, alias `lh automations`)

Manage automations: MCP Events subscriptions, the `mcp_events` rows of the `inbound_webhooks` table, shown on the Web under Settings → Automations. An agent creates one in a conversation (the MCP Events tool); the CLI lists, views, renames, checks and deletes them, and never creates one.

**Source**: `apps/cli/src/commands/automation.ts` (registration and actions), `automation/format.ts` (table and details), `webhook/shared.ts` (shared with `lh webhook`: id check, kind guards, error texts, status and target formatting)

**Server**: TRPC `inboundWebhook.*` (`apps/server/src/routers/lambda/inboundWebhook.ts`), the same router as `lh webhook`; the rules live in `apps/server/src/services/inboundWebhook/manage.ts`.

Custom webhooks (`generic` rows) are not automations: every `lh automation` command that takes an id refuses one with "… is a custom webhook, not an automation …" and the `lh webhook` command to use (`view`, `edit --name`, `test`, `delete`).

## Name and event

- `name`: for people, freely renamed; `null` shows the event.
- `identifier`: the subscription's event (`source.eventName`), how the agent knows it (`<mcpEvent event=…>`). Fixed for the row's life; shown as "Event", never editable.

## Commands

| Command                                               | Procedure                      | Notes                                                                               |
| ----------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `lh automation list [--agent <id>] [--json [fields]]` | `list({ kind: 'mcp_events' })` | Columns: name, connector, event, agent, status, results to, last event              |
| `lh automation view <id> [--json [fields]]`           | `get`                          | Connector, filter (`source.arguments`), last error, Topic or Channel/Thread, expiry |
| `lh automation rename <id> <name> [--json [fields]]`  | `update({ id, name })`         | Trimmed, at most 100 characters; the event stays                                    |
| `lh automation rename <id> --clear [--json [fields]]` | `update({ id, name: null })`   | The automation shows its event again                                                |
| `lh automation check <id> [--json [fields]]`          | `check`                        | Renews or recovers the subscription; the server allows one check per 30 seconds     |
| `lh automation delete <id> [--yes]`                   | `delete`                       | Confirms: this also ends the subscription on the MCP server                         |

Where results go comes from `source.delivery` with the visible `item.channel` (Channel / Thread titles), else `item.topic`.

## Rules enforced locally

- Ids must be uuids.
- A `generic` id is refused before any change.
- `rename` needs exactly one of a non-blank `<name>` or `--clear`.
