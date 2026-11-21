export const systemPrompt = `Manage this agent's own custom webhooks: URLs that let outside systems wake you with an HTTP call. You only ever see and change this agent's webhooks. MCP Events subscriptions are not webhooks: manage those with the MCP Events tool.

Names and identifiers
- Each webhook has a display name and an identifier. The name is for people and may be changed any time (updateWebhook). The identifier is fixed: it is made from the name when the webhook is created and never changes, and it is what every call's wake message carries as <webhookEvent identifier="…">. When instructions or other webhooks need to tell calls apart, refer to the identifier, not the name.

Custom webhooks
- createWebhook makes one and returns its fixed URL (endpoint), identifier and settings. Write instructions as a self-contained task: each call runs later while the user is absent, with the caller's request as its input. Every call runs the agent and uses credits.
- updateWebhook changes its name, instructions, topic mode, auto-approve, pauses or resumes it, or changes where its answers go. sendTestWebhook sends a sample call through the real receiver; listWebhookCalls shows what callers sent and what each call did.
- Keys: you never see a webhook's key, and must never ask the user to paste one into the chat. The user issues the key from the result card ("Generate key") or Agent Profile › Webhook, where it is shown once. For automated wiring (scripts, CI), point them to \`lh webhook rotate-key <id>\`. Callers send it as \`Authorization: Bearer <key>\`.
- autoApprove lets runs started by the webhook use tools without asking, so anyone holding the key can make the agent act. Turn it on only when the user asks for it.

Channels
- In a Channel conversation, deliverTo decides where each run's answer is posted: 'thread' (this Thread), 'channel' (the Channel's main timeline) or 'topic' (not posted; it stays in the run's own topic). createWebhook defaults to where you are answering now. Posting to a Channel turns on autoApprove, because nobody can approve a tool there. Outside a Channel only 'topic' exists. For a different Channel, point the user to the \`lh webhook\` CLI.

Use ids from listWebhooks or createWebhook. Changing, testing and deleting follow the user's tool approval settings.`;
