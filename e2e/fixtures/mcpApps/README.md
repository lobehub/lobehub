# MCP Apps acceptance fixture

This local fixture serves an MCP Streamable HTTP endpoint and HTML MCP Apps resources. It uses the repository's installed `@modelcontextprotocol/server` package; it adds no dependencies.

Run from the repository root:

```sh
bun e2e/fixtures/mcpApps/server.mts
bun e2e/fixtures/mcpApps/smoke.mts
```

The default endpoint is `http://localhost:39742/mcp` (`MCP_APP_FIXTURE_PORT` overrides the port); readiness is at `/health`. Register the endpoint as a Streamable HTTP MCP server in the acceptance environment.

The fixture provides inline/fullscreen tool preferences, a resource with both display modes and no tool preference, an empty thread entrypoint, the legacy `openai/outputTemplate`, conflicting `openai/ui` and `lobehub/ui` metadata, an app-only tool, and a model tool for disabled-tool coverage. Its HTML uses the MCP Apps JSON-RPC `postMessage` bridge directly. The teardown button sends the SDK-supported `ui/notifications/request-teardown`; the host's `ui/resource-teardown` request is acknowledged before removal.

The thread entrypoint is app-only (`ui.visibility: ['app']`), so opening it from the sidebar also exercises the rule that manual entrypoints ignore model visibility.

Use **Replace with context B** to test overwrite semantics. To inspect teardown ordering, enable **Pause teardown acknowledgement**, request teardown, then acknowledge from the still-mounted App before the host timeout. **Request teardown in 3 seconds** lets you hide the pane before it notifies the host.

`smoke.mts` exercises initialize/session negotiation, initialization notification, tool listing and metadata, a tool call, and resource read. It is a fixture protocol smoke only; it does not run the product acceptance cases.

## Deterministic local model fixture

For auditable context and tool-call exploration, start `bun e2e/fixtures/mcpApps/model-server.mts`. It exposes an OpenAI-compatible streaming endpoint at `http://127.0.0.1:39743/v1/chat/completions`, responds with a tool call when the latest user message includes one of the advertised fixture tool names, and otherwise echoes whether the context marker was included. Each full request body is recorded as one JSONL entry in `/tmp/mcp-apps-model-requests.jsonl`; these traces may contain conversation content, so keep them local and delete them after use.

List multiple `fixture_*` tool names in one user message to emit multiple calls in one assistant reply. Only tools advertised in that request are eligible; repeated names are deduplicated. The model stops calling tools after receiving their results. A server restart clears its request log: archive the log before restarting during acceptance. Run the model smoke against a fresh, isolated log.

Add an OpenAI-compatible provider/model through the product's normal provider settings, with base URL `http://127.0.0.1:39743/v1`, model ID `mcp-apps-fixture`, and any non-empty local API key. Then choose that model in the isolated test agent. The fixture smoke can be run with `bun e2e/fixtures/mcpApps/model-smoke.mts`; it verifies streaming tool-call output, context echo, and request-body auditing. This is only a deterministic debugging aid, not a final product acceptance result.
