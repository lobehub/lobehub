# Local Provider Integration

Use this reference for a local model server or desktop application's external API. These are integration checks, not requirements to patch the upstream application, expose a public tunnel, or change the user's security settings.

## Establish What Is Reachable

Distinguish the API destination from the browser origin. CORS checks the requesting page's scheme, host, and port; it does not require that port to match the API port. Check the installed release and actual launch mode: desktop API-only and CLI web-server modes can expose the same protocol with different access policies. Keep runtime defaults, settings placeholders, and documentation aligned with the upstream default; an explicit test port is not a new default.

Trace the effective request path, including stored browser-request settings and default selectors. An unchecked switch is not proof of a server request. For server requests, loopback refers to the server or container; for browser requests, it refers to the user's machine.

Inspect `isProviderFetchOnClient` in `src/store/aiInfra/slices/aiProvider/selectors.ts`. Its base-URL-only default selects browser requests. The current `providerWhitelist` allows an explicit saved preference to take precedence; membership alone does not change an undefined preference. When a local provider must support an explicit server request without a key, check this path and its tests rather than changing only the provider card.

Separate the following evidence:

| Check                                                        | What it establishes                                       |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| Listener / health                                            | The selected service is running                           |
| Preflight with the actual Origin, method and request headers | Browser CORS admission for that request                   |
| Endpoint authentication                                      | Whether the actual caller and credential are admitted     |
| Model discovery                                              | Which model IDs the instance advertises                   |
| Inference / tool round trip                                  | Whether the selected model serves the requested operation |

A successful terminal request or preflight does not establish browser authentication. A keyless option may restrict cross-site browser callers independently of CORS. Check the provider's policy and the SDK's actual Authorization header: a placeholder key can be rejected instead of treated as absent. Do not recommend arbitrary credentials, disabling authentication, or tunneling as a generic fix. Search upstream issues and fixes before declaring a setting unavailable; an unmerged PR's environment variable is not a released configuration option.

## Discover Models and Capabilities

Model IDs from local servers can include publisher prefixes, format suffixes, aliases, and quantization variants. Exact matching against a bundled catalog can miss a supported model. A sibling adapter using that lookup is a precedent to inspect, not proof that it handles unknown local IDs correctly.

- Inspect the actual model-list payload before interpreting missing capability fields as unsupported. Prefer explicit server metadata when it describes the selected model; use verified catalog metadata as a fallback. Do not infer tools or vision merely from a model-family substring.
- If a separate properties endpoint describes only the resident model, match its public model ID to the list and respect explicit unloaded state. Do not assign one loaded model's capabilities to all downloaded models. Preserve authentication and reverse-proxy prefixes; bound optional probes and retain model discovery when older servers lack that endpoint.
- Preserve explicit `false` values when the field measures the capability itself. Parameter support is narrower: for example, `supports_reasoning_effort: false` does not disprove reasoning through other controls such as `enable_thinking`. Prefer a valid positive configured context length to the model's theoretical maximum. Treat metadata as evidence for UI capability flags, not proof of a successful tool execution.
- Follow capabilities through runtime output, persistence/refresh, selectors, and the Agent-mode control. Start at `src/store/aiInfra/slices/aiModel/action.ts` and `packages/database/src/models/aiModel.ts`. Check whether refreshing updates existing records and whether merge rules can clear stale capabilities; returning the correct runtime object alone may not repair saved data.
- Test an unknown-but-capable ID, mismatched or unloaded models, explicit negative capabilities, and an unavailable optional metadata endpoint when those cases apply. Use realistic HTTP payloads and content types at the SDK boundary.

Do not default-enable example models that the user's instance may not have installed. Keep examples or catalog metadata separate from discovery, and preserve existing user choices. Explain that fetching models, choosing a connection-check model, and loading it for inference are distinct steps. For resident-only metadata, tell users to load the model and refresh discovery before relying on its capability flags.

## Unsloth Example

During the September 2026 integration, `/v1/models` advertised a loaded GGUF model and its configured context length but omitted tool and vision flags. Studio's `/props` exposed `model_path`, `chat_template_caps`, and `modalities`; matching that ID allowed capability discovery without guessing from the model name. The [LobeHub adapter at that revision](https://github.com/lobehub/lobehub/blob/f03cd9d253e3fd7954469393ffc194a634696b1b/packages/model-runtime/src/providers/unsloth/index.ts) records the implementation. Inspect the current [Unsloth compatibility route](https://github.com/unslothai/unsloth/blob/main/studio/backend/routes/llama_compat.py) before reusing it: these fields and access policies are provider- and version-specific.
