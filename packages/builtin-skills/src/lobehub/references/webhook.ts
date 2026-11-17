const content = `# lh webhook (alias: lh webhooks) - Custom Webhooks

A custom webhook is a URL any system calls with \`Authorization: Bearer <key>\`. Each call wakes its agent with what was sent. Webhooks are created, changed, tested and deleted here.

MCP Events subscriptions are automations, not webhooks: manage them with \`lh automation\` (see \`references/automation\`). \`lh webhook\` refuses an automation's id and names the \`lh automation\` command to use.

## Name and identifier

- **Name** - for people; set with \`--name\`, change or clear it any time.
- **Identifier** - how the agent knows the webhook (\`<webhookEvent identifier=…>\` in the run). It is made from the name when the webhook is created (lowercase words joined by dashes, \`webhook\` when the name has none) and never changes, so renaming does not break instructions that refer to it. It cannot be set or edited.

## Subcommands

- \`lh webhook list [--agent <agentId>] [--json [fields]]\` - Custom webhooks you can see: id, name, identifier, agent, status, target, last call
- \`lh webhook view <id> [--json [fields]]\` - Name, identifier, settings, the call URL, a curl example and the last error
- \`lh webhook create --agent <agentId> [options]\` - Create a custom webhook; prints its identifier, URL and key
- \`lh webhook edit <id> [options]\` - Change a custom webhook (only the flags given change); \`--name\` renames it, the identifier stays
- \`lh webhook pause <id>\` / \`lh webhook resume <id>\` - Refuse calls (HTTP 409) until resumed
- \`lh webhook rotate-key <id> [--yes]\` - Issue a new key; the old key stops working at once, the URL stays
- \`lh webhook test <id>\` - Send a sample call; the agent runs as it would for a real caller
- \`lh webhook calls <id> [-L <n>] [--all] [--json [fields]]\` - Calls received, newest first: result, skip reason, topic, request preview (20 by default)
- \`lh webhook delete <id> [--yes]\` - Delete; the URL stops working at once

\`<id>\` is the webhook's uuid from \`lh webhook list\`.

## create / edit options

- \`--name <name>\` - Display name. On \`create\` the identifier is made from it; on \`edit\` only the name changes
- \`--instructions <text>\` - What the agent should do with each call. The request's content is treated as data, never as instructions
- \`--topic-mode new|reuse\` - \`new\` (default): each run starts a new topic; \`reuse\`: every call continues one shared topic
- \`--topic <topicId>\` - With \`reuse\`, continue this existing topic (one of your own topics of that agent); implies \`--topic-mode reuse\`
- \`--auto-approve\` - Runs use tools without waiting for approval (tools marked to always ask still wait). Anyone with the URL and key can then make the agent act, so turn it on only when the user asks
- \`--channel <channelId>\` - Post each run's final answer to this Channel (\`chn_...\`) as the agent's message; the run itself still works in a topic. Requires \`--auto-approve\` (nobody can approve a tool call in a Channel), and both the user and the agent must be members of the Channel
- \`--thread <threadId>\` - Post to this Thread (\`cht_...\`) of the Channel instead of its main timeline. On \`edit\`, \`--thread\` alone keeps the current Channel
- \`edit\` only: \`--no-name\` (the webhook then shows its identifier), \`--no-instructions\`, \`--no-topic\` (forget the picked topic), \`--no-auto-approve\`, \`--no-channel\` (stop posting to a Channel). Auto-approval cannot be turned off while the webhook still posts to a Channel: pass \`--no-channel\` with it

## The key

The key is shown once: by \`create\` and by \`rotate-key\` (as \`secret\` with \`--json\`). It is stored encrypted and never returned again. Hand it to the user or the calling system right away; if it is lost, \`rotate-key\` issues a new one. Never put the key in a message, document or memory unless the user asks.

## Calling a custom webhook

\`\`\`bash
curl -X POST <url> -H "Authorization: Bearer <key>" -H 'content-type: application/json' -d '{"text":"Build #42 failed"}'
\`\`\`

Any body works (JSON, a form or plain text, up to 256 KB). Append \`?thread=<key>\` to the URL (or send \`X-Thread-Key\`) to keep related calls in one topic. Send an \`Idempotency-Key\` header so a retried call runs once.

## Examples

\`\`\`bash
lh webhook create --agent <agentId> --name "CI alerts" --instructions "Summarize the failure and open an issue if it is new"
lh webhook create --agent <agentId> --name "Deploys" --auto-approve --channel <channelId> --thread <threadId>
lh webhook list --agent <agentId> --json id,name,identifier,status
lh webhook edit <id> --topic-mode reuse --no-instructions
lh webhook edit <id> --no-channel --no-auto-approve
lh webhook test <id>
lh webhook calls <id> --limit 50
lh webhook rotate-key <id> --yes --json id,endpoint,secret
lh webhook delete <id> --yes
\`\`\`
`;

export default content;
