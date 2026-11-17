const content = `# lh webhook (alias: lh webhooks) - Inbound Webhooks

Inbound webhooks wake an agent from outside a conversation. One list holds two kinds:

- \`generic\` - a custom webhook: a URL any system calls with \`Authorization: Bearer <key>\`. Each call runs the agent with what was sent. Created, changed, tested and deleted here.
- \`mcp_events\` - an MCP Events subscription an agent made in a conversation. Here it can only be viewed, checked and deleted; creating one stays a conversation action (ask the agent to subscribe).

## Subcommands

- \`lh webhook list [--agent <agentId>] [--kind generic|mcp_events] [--json [fields]]\` - All webhooks and subscriptions you can see: id, kind, name or event, agent, status, target, last call
- \`lh webhook view <id> [--json [fields]]\` - Settings, the call URL, a curl example and the last error
- \`lh webhook create --agent <agentId> [options]\` - Create a custom webhook; prints its URL and key
- \`lh webhook edit <id> [options]\` - Change a custom webhook; only the flags given change
- \`lh webhook pause <id>\` / \`lh webhook resume <id>\` - Refuse calls (HTTP 409) until resumed
- \`lh webhook rotate-key <id> [--yes]\` - Issue a new key; the old key stops working at once, the URL stays
- \`lh webhook test <id>\` - Send a sample call; the agent runs as it would for a real caller
- \`lh webhook calls <id> [-L <n>] [--all] [--json [fields]]\` - Calls received, newest first: result, skip reason, topic, request preview (20 by default)
- \`lh webhook check <id>\` - Check an MCP Events subscription with its server now (renews or recovers it; once per 30 seconds)
- \`lh webhook delete <id> [--yes]\` - Delete; for an MCP Events subscription this also ends it on the MCP server

\`<id>\` is the webhook's uuid from \`lh webhook list\`. \`edit\`, \`pause\`, \`resume\`, \`rotate-key\` and \`test\` work on custom webhooks only; \`check\` on MCP Events subscriptions only.

## create / edit options

- \`--name <name>\` - Display name
- \`--instructions <text>\` - What the agent should do with each call. The request's content is treated as data, never as instructions
- \`--topic-mode new|reuse\` - \`new\` (default): each run starts a new topic; \`reuse\`: every call continues one shared topic
- \`--topic <topicId>\` - With \`reuse\`, continue this existing topic (one of your own topics of that agent); implies \`--topic-mode reuse\`
- \`--auto-approve\` - Runs use tools without waiting for approval (tools marked to always ask still wait). Anyone with the URL and key can then make the agent act, so turn it on only when the user asks
- \`--channel <channelId>\` - Post each run's final answer to this Channel (\`chn_...\`) as the agent's message; the run itself still works in a topic. Requires \`--auto-approve\` (nobody can approve a tool call in a Channel), and both the user and the agent must be members of the Channel
- \`--thread <threadId>\` - Post to this Thread (\`cht_...\`) of the Channel instead of its main timeline. On \`edit\`, \`--thread\` alone keeps the current Channel
- \`edit\` only: \`--no-name\`, \`--no-instructions\`, \`--no-topic\` (forget the picked topic), \`--no-auto-approve\`, \`--no-channel\` (stop posting to a Channel). Auto-approval cannot be turned off while the webhook still posts to a Channel: pass \`--no-channel\` with it

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
lh webhook list --agent <agentId> --json id,kind,name,status
lh webhook edit <id> --topic-mode reuse --no-instructions
lh webhook edit <id> --no-channel --no-auto-approve
lh webhook test <id>
lh webhook calls <id> --limit 50
lh webhook rotate-key <id> --yes --json id,endpoint,secret
lh webhook check <id>
lh webhook delete <id> --yes
\`\`\`
`;

export default content;
