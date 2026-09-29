# Deployment webhook configuration

These five server-only variables add webhook hooks to every server operation,
including child runs and approval continuations. With none configured, existing
hooks and scheduling are unchanged. Set `AGENT_HOOK_WEBHOOK_URL` to enable them.

```dotenv
AGENT_HOOK_WEBHOOK_URL=http://webhook-service/ingress
AGENT_HOOK_WEBHOOK_TOKEN=my-token
AGENT_HOOK_WEBHOOK_EVENTS=beforeToolCall, afterToolCall, onToolCallError
AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING=toolCall
AGENT_HOOK_WEBHOOK_ON_ERROR=block
```

| Variable                               | Meaning                                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_HOOK_WEBHOOK_URL`               | Shared destination, validated by the existing webhook URL schema. HTTP and HTTPS internal hostnames are supported.                                                                 |
| `AGENT_HOOK_WEBHOOK_TOKEN`             | Required and nonblank when URL is set. Sent as a Bearer token.                                                                                                                     |
| `AGENT_HOOK_WEBHOOK_EVENTS`            | Required when URL is set. Comma-separated existing Hook types; whitespace and empty entries are removed and duplicates coalesced. Unknown names, including `...`, fail validation. |
| `AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING` | `ignore` (default) or `toolCall`. Applies only to `beforeToolCall`; `toolCall` requires that event in the list.                                                                    |
| `AGENT_HOOK_WEBHOOK_ON_ERROR`          | `continue` (default) or `block`. Applies only to `beforeToolCall`; `block` requires `toolCall` response handling.                                                                  |

Every selected event gets one stable `server-env-webhook:<event>` ID. All use
`fetch` delivery; runtime local/queue scheduling remains unchanged. Events other
than `beforeToolCall` always use `ignore` and `continue`.

Registration preserves caller hooks and internal callbacks. These reserved IDs
are owned by server configuration: a caller cannot replace an enabled server
hook by reusing its ID. Registration and restoration coalesce these IDs. Current
deployment settings also apply when dispatching an older runtime snapshot.

Persisted hooks contain the literal header template
`Bearer ${AGENT_HOOK_WEBHOOK_TOKEN}` and allowlist only that variable. The sending
worker resolves its own process token; the actual token is never copied into
serialized hooks. Workers restoring persisted hooks must have the token set.

This configuration uses the existing control response and notification contracts
in [TOOL_CONTROL.md](./TOOL_CONTROL.md). It adds no events, payload fields, or
additional environment options.
