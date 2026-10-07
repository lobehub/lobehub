# Heterogeneous agents

Shared adapters, execution protocols, event ingestion, and provider-binding support for external agent runtimes.

## Provider binding hosts

`@lobechat/heterogeneous-agents/providerBindingHost` prepares private Node-hosted profiles and transient run files. Desktop and the connected-device CLI use this same host. `@lobechat/heterogeneous-agents/codexProviderBinding` supplies the Codex plan and native argument sanitizer.

Use these exports after validating the provider, enabled model, authentication scope, and protocol. Keep resolved credentials on the execution host. Gateway requests use the reference-only contract from `@lobechat/heterogeneous-agents/protocol`; the receiving personal connector resolves the provider itself.

Do not import the Node host in browser code or use it to bypass workspace/device authorization. A session may resume only when its binding identity matches the selected profile. Always call the prepared cleanup callback after the run finishes or fails.
