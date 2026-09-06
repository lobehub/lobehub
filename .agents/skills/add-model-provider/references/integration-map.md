# Integration Map and Precedents

Use this map to locate the current code. Verify paths and consumers before editing; additions with different authentication or protocols need different subsets.

## Registration and Configuration

| Concern                       | Current location                                                                                                                       | What to verify                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Provider identity             | `packages/model-bank/src/const/modelProvider.ts`                                                                                       | Stable `ModelProvider` ID used by all maps                                    |
| Provider card                 | `packages/model-bank/src/modelProviders/<provider>.ts`                                                                                 | Name, public URLs, `checkModel`, authentication, fetcher and browser settings |
| Provider registration         | `packages/model-bank/src/modelProviders/index.ts`                                                                                      | Import, `DEFAULT_MODEL_PROVIDER_LIST` position, card export                   |
| Model cards                   | `packages/model-bank/src/aiModels/<provider>.ts`                                                                                       | Evidence-backed metadata, supported abilities, default enablement, prices     |
| Model registration            | `packages/model-bank/src/aiModels/index.ts`                                                                                            | Import, `staticModelMap`, named export keyed to the provider ID               |
| Package access                | `packages/model-bank/package.json`                                                                                                     | New model module's subpath export, including filename casing                  |
| Runtime implementation        | `packages/model-runtime/src/providers/<provider>/index.ts`                                                                             | Factory reuse, endpoint, protocol, payload and response behavior              |
| Runtime registration          | `packages/model-runtime/src/runtimeMap.ts`, `packages/model-runtime/src/index.ts`                                                      | ID-to-runtime map and public export                                           |
| Distinct routed adapter       | `packages/model-runtime/src/core/RouterRuntime/apiTypes.ts`, `baseRuntimeMap.ts`                                                       | Add only when this adapter is needed; test runtime selection                  |
| API-key environment           | `packages/env/src/llm.ts`                                                                                                              | Schema and `runtimeEnv`; enablement semantics                                 |
| Server provider configuration | `apps/server/src/globalConfig/genServerAiProviderConfig.ts`                                                                            | Generic uppercase ID conventions, model list and enablement overrides         |
| Runtime credentials/options   | `apps/server/src/modules/ModelRuntime/index.ts`                                                                                        | Generic API-key/proxy handling versus provider-specific initialization        |
| OAuth flow                    | `apps/server/src/services/oauthDeviceFlow/`, `apps/server/src/routers/lambda/oauthDeviceFlow.ts`                                       | Factory registration, token exchange/refresh, account metadata, disconnect    |
| New parameter controls        | `packages/model-bank/src/types/aiModel.ts`, `packages/types/src/agent/chatConfig.ts`, `src/services/chat/mecha/modelParamsResolver.ts` | Trace consumers into controls and translations; avoid changing types alone    |
| Default list consumption      | `packages/database/src/repositories/aiInfra/index.ts`, `src/store/aiInfra/slices/aiProvider/selectors.ts`                              | Built-in order versus enabled-provider custom sort                            |

Provider-specific `*_MODEL_LIST` and `*_PROXY_URL` may be consumed dynamically. Trace the configuration path before adding redundant schema entries or documenting an unsupported variable. The deprecated `LOBE_DEFAULT_MODEL_LIST` is not a substitute for the modern model map; inspect actual consumers before changing it.

Provider description translations live in `locales/en-US/providers.json` and `locales/zh-CN/providers.json` as flat `<provider-id>.description` keys. `packages/locales/src/default/providers.ts` derives defaults from the cards and is not a per-provider manual registry. Verify these translations even if the precedent PR omitted them.

## Contrasting Examples

Read these as evidence of different integration shapes, not as code to copy wholesale. Use the latest source and relevant official API documentation for a new provider.

- [PR lobehub#17527](https://github.com/lobehub/lobehub/pull/17527), ChatGPT subscription authentication: a provider with OAuth device authorization, account metadata and Responses support. The diff also extends reasoning-signature transport and structured generation. It does not establish that all providers need OAuth, private protocol headers, or shared streaming changes. Its reported public endpoint checks are not proof of live authenticated inference.
- [PR lobehub#13713](https://github.com/lobehub/lobehub/pull/13713), AntGroup: a conventional API-key provider using the OpenAI-compatible factory, environment bindings, separate model/provider cards and provider-specific reasoning controls. Missing runtime tests or setup documentation in an older diff do not exempt a new integration from validation or documentation.
- [PR lobehub#19152](https://github.com/lobehub/lobehub/pull/19152), Meta: Responses-only chat and structured generation, explicit RouterRuntime registration and package export, independent provider/model branding, and deliberate list placement. This was an open PR when inspected on 2026-09-06; verify which changes exist in the checkout before reusing them. Its shared error-translation and Workbench fixes are conditional regression lessons, not files every provider must modify.

## Focused Regression Lessons

**Protocol selection:** `chatCompletion.useResponse` does not prove `generateObject` selects Responses. Test the actual structured-generation call and whether an explicit caller mode can select an unsupported API. Append hosted search tools without losing existing function tools; map response formats without dropping unrelated fields.

**State across turns:** when a provider requires encrypted reasoning or other opaque state, verify preservation across streaming, non-streaming, persistence and subsequent requests. Follow the provider's replay rules, including cross-provider boundaries. Do not request reasoning state for unrelated providers by default.

**Brand collisions:** a model containing `Spark` can match another provider's generic Spark rule. Verify the intended match against the installed icon release and the rendered model row; a correct provider icon alone is insufficient.

**Icon registration and package identity:** an exported brand component does not prove `ProviderIcon` or `ProviderCombine` has a provider-ID mapping. Check the installed mapping and the actual consumer. In a workspace with duplicate dependency instances, registration or a React context may reach only one copy; compare resolved module paths before attributing a lazy error-panel crash to the provider API. `src/libs/providerIcon.ts` is the Unsloth workaround: it registers the missing mapping near its consumers to avoid importing the full registry at startup. Remove the registration once the installed upstream release includes the mapping, checking rendered icons and tree shaking when changing it.

**Error localization:** examine `packages/fetch-sse/src/parseError.ts`, `packages/model-runtime/src/errors/specs.ts` (`getErrorCodeSpec`) and `src/utils/locale/runtimeErrorMessage.ts` if errors show raw keys. The Meta PR introduces `packages/model-runtime/src/errors/i18nKey.ts` to centralize that routing; use it when present in the checkout. Non-React code may need namespace loading. Workbench's client loader is `apps/workbench/app/stubs/loadI18nNamespaceModule.client.ts`; its default and translated language globs must agree. Reuse existing helpers when available instead of adding parallel error-routing logic.
