---
name: gortex-platforms-telegram-61-dirs
description: 'Work in the platforms/telegram +61 dirs area — 266 symbols across 70 files (72% cohesion)'
---

# platforms/telegram +61 dirs

266 symbols | 70 files | 72% cohesion

## When to Use

Use this skill when working on files in:

- `apps/cli/src/commands/login.ts`
- `apps/desktop/src/main/controllers/__tests__/AuthCtr.test.ts`
- `packages/agent-tracing/src/cli/inspect.ts`
- `packages/chat-adapter-qq/src/adapter.ts`
- `packages/chat-adapter-wechat/src/api.ts`
- `packages/memory-user-memory/benchmarks/locomo/run.ts`
- `packages/model-runtime/src/core/anthropicCompatibleFactory/index.ts`
- `packages/model-runtime/src/providers/aihubmix/index.ts`
- `packages/model-runtime/src/providers/cloudflare/index.ts`
- `packages/model-runtime/src/providers/comfyui/index.ts`
- `packages/model-runtime/src/providers/nebius/index.test.ts`
- `packages/model-runtime/src/providers/nebius/index.ts`
- `packages/model-runtime/src/providers/straico/index.ts`
- `packages/model-runtime/src/types/image.ts`
- `packages/types/src/aiProvider.ts`
- `packages/types/src/discover/fork.ts`
- `packages/types/src/tool/search/index.ts`
- `packages/types/src/user/settings/keyVaults.ts`
- `packages/web-crawler/src/crawImpl/naive.ts`
- `scripts/clerk-to-betterauth/export-clerk-users-with-api.ts`
- `src/app/(backend)/api/auth/[...all]/route.ts`
- `src/app/(backend)/api/webhooks/casdoor/route.ts`
- `src/app/(backend)/api/webhooks/casdoor/validateRequest.ts`
- `src/app/(backend)/api/webhooks/logto/route.ts`
- `src/app/(backend)/api/webhooks/logto/validateRequest.ts`
- `src/app/(backend)/webapi/create-image/comfyui/route.ts`
- `src/app/(backend)/webapi/tts/edge/route.ts`
- `src/app/(backend)/webapi/tts/microsoft/route.ts`
- `src/components/Analytics/ReactScan.tsx`
- `src/features/DataImporter/config.ts`
- `src/features/ResourceManager/components/Explorer/ItemDropdown/useFileItemDropdown.tsx`
- `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/index.tsx`
- `src/libs/better-auth/sso/providers/feishu.ts`
- `src/libs/better-auth/sso/providers/wechat.ts`
- `src/libs/document-loaders/loaders/csv/index.ts`
- `src/libs/trpc/client/lambda.ts`
- `src/libs/trusted-client/index.ts`
- `src/routes/(main)/(create)/image/features/PromptInput/index.tsx`
- `src/routes/(main)/settings/apikey/features/ApiKeyDisplay/index.tsx`
- `src/server/modules/AgentRuntime/GatewayStreamNotifier.ts`
- `src/server/routers/lambda/market/agent.ts`
- `src/server/routers/lambda/market/agentGroup.ts`
- `src/server/services/bot/platforms/discord/api.ts`
- `src/server/services/bot/platforms/discord/client.ts`
- `src/server/services/bot/platforms/slack/client.ts`
- `src/server/services/bot/platforms/telegram/api.ts`
- `src/server/services/bot/platforms/telegram/client.ts`
- `src/server/services/bot/platforms/telegram/helpers.ts`
- `src/server/services/bot/platforms/types.ts`
- `src/server/services/desktopRelease/index.ts`
- `src/server/services/gateway/MessageGatewayClient.ts`
- `src/server/services/market/index.ts`
- `src/server/services/messenger/oauth/slackOAuth.ts`
- `src/server/services/messenger/platforms/discord/oauth.ts`
- `src/server/services/messenger/platforms/slack/binder.ts`
- `src/server/services/oauthDeviceFlow/index.ts`
- `src/server/services/oauthDeviceFlow/providers/githubCopilot.ts`
- `src/server/services/search/impls/anspire/index.ts`
- `src/server/services/search/impls/bocha/index.ts`
- `src/server/services/search/impls/brave/index.ts`
- `src/server/services/search/impls/exa/index.ts`
- `src/server/services/search/impls/firecrawl/index.ts`
- `src/server/services/search/impls/google/index.ts`
- `src/server/services/search/impls/jina/index.ts`
- `src/server/services/search/impls/kagi/index.ts`
- `src/server/services/search/impls/search1api/index.ts`
- `src/server/services/search/impls/searxng/index.ts`
- `src/server/services/search/impls/tavily/index.ts`
- `src/server/services/search/impls/type.ts`
- `src/store/file/slices/document/selectors.ts`

## Key Files

| File                                                                                    | Symbols                                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/cli/src/commands/login.ts`                                                        | parseJsonResponse, res, T, endpoint                                                          |
| `apps/desktop/src/main/controllers/__tests__/AuthCtr.test.ts`                           | json, text                                                                                   |
| `packages/agent-tracing/src/cli/inspect.ts`                                             | fetchSnapshotFromUrl, url                                                                    |
| `packages/chat-adapter-qq/src/adapter.ts`                                               | fetchAttachmentData, url                                                                     |
| `packages/chat-adapter-wechat/src/api.ts`                                               | constructor, url, baseUrl, QrStatusResponse, baseUrl, ...                                    |
| `packages/memory-user-memory/benchmarks/locomo/run.ts`                                  | post, path, main, body                                                                       |
| `packages/model-runtime/src/core/anthropicCompatibleFactory/index.ts`                   | createDefaultAnthropicModels                                                                 |
| `packages/model-runtime/src/providers/aihubmix/index.ts`                                | mapAiHubMixModel, params.models, m                                                           |
| `packages/model-runtime/src/providers/cloudflare/index.ts`                              | models                                                                                       |
| `packages/model-runtime/src/providers/comfyui/index.ts`                                 | constructor, baseURL, getAuthHeaders, LobeComfyUI, options, ...                              |
| `packages/model-runtime/src/providers/nebius/index.test.ts`                             | json                                                                                         |
| `packages/model-runtime/src/providers/nebius/index.ts`                                  | params.models                                                                                |
| `packages/model-runtime/src/providers/straico/index.ts`                                 | formatPrice, pricing, cleanModelName, name, LobeStraicoAI.models                             |
| `packages/model-runtime/src/types/image.ts`                                             | AuthenticatedImageRuntime                                                                    |
| `packages/types/src/aiProvider.ts`                                                      | OAuthDeviceFlowConfig                                                                        |
| `packages/types/src/discover/fork.ts`                                                   | AgentForkBatchResult                                                                         |
| `packages/types/src/tool/search/index.ts`                                               | UniformSearchResponse, SearchParams, SearchQuery                                             |
| `packages/types/src/user/settings/keyVaults.ts`                                         | FalKeyVault                                                                                  |
| `packages/web-crawler/src/crawImpl/naive.ts`                                            | url, naive                                                                                   |
| `scripts/clerk-to-betterauth/export-clerk-users-with-api.ts`                            | fetchClerkApi, endpoint, secretKey, T                                                        |
| `src/app/(backend)/api/auth/[...all]/route.ts`                                          | request, request, malformedJsonResponse, validateJsonBody, POST                              |
| `src/app/(backend)/api/webhooks/casdoor/route.ts`                                       | req, POST                                                                                    |
| `src/app/(backend)/api/webhooks/casdoor/validateRequest.ts`                             | request, secret, validateRequest                                                             |
| `src/app/(backend)/api/webhooks/logto/route.ts`                                         | req, POST                                                                                    |
| `src/app/(backend)/api/webhooks/logto/validateRequest.ts`                               | signingKey, request, validateRequest                                                         |
| `src/app/(backend)/webapi/create-image/comfyui/route.ts`                                | handler, req, POST, req                                                                      |
| `src/app/(backend)/webapi/tts/edge/route.ts`                                            | req, POST                                                                                    |
| `src/app/(backend)/webapi/tts/microsoft/route.ts`                                       | req, POST                                                                                    |
| `src/components/Analytics/ReactScan.tsx`                                                | ReactScanProps                                                                               |
| `src/features/DataImporter/config.ts`                                                   | parseConfigFile, file                                                                        |
| `src/features/ResourceManager/components/Explorer/ItemDropdown/useFileItemDropdown.tsx` | onClick                                                                                      |
| `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/index.tsx`    | fetchContent, node, extractTextFromEditorJSON, extractFromNode, editorData                   |
| `src/libs/better-auth/sso/providers/feishu.ts`                                          | getToken, tokens, getUserInfo                                                                |
| `src/libs/better-auth/sso/providers/wechat.ts`                                          | tokens, getUserInfo, getToken                                                                |
| `src/libs/document-loaders/loaders/csv/index.ts`                                        | fileBlob, CsVLoader                                                                          |
| `src/libs/trpc/client/lambda.ts`                                                        | init, input, linkOptions.fetch                                                               |
| `src/libs/trusted-client/index.ts`                                                      | generateTrustedClientToken, TrustedClientUserInfo, userInfo                                  |
| `src/routes/(main)/(create)/image/features/PromptInput/index.tsx`                       | handleGenerate                                                                               |
| `src/routes/(main)/settings/apikey/features/ApiKeyDisplay/index.tsx`                    | ApiKeyDisplayProps                                                                           |
| `src/server/modules/AgentRuntime/GatewayStreamNotifier.ts`                              | path, body, httpPost                                                                         |
| `src/server/routers/lambda/market/agent.ts`                                             | options, headers, fetchMarketUserInfo, forkOneAgent, buildMarketAuthHeaders, ...             |
| `src/server/routers/lambda/market/agentGroup.ts`                                        | FetchMarketUserInfoOptions, options, fetchMarketUserInfo                                     |
| `src/server/services/bot/platforms/discord/api.ts`                                      | editInteractionOriginalWithButtons, interactionToken, buttons, content, applicationId        |
| `src/server/services/bot/platforms/discord/client.ts`                                   | credentials, validateCredentials                                                             |
| `src/server/services/bot/platforms/slack/client.ts`                                     | settings, validateCredentials, credentials                                                   |
| `src/server/services/bot/platforms/telegram/api.ts`                                     | method, file, callMultipart, fields, attempt, ...                                            |
| `src/server/services/bot/platforms/telegram/client.ts`                                  | validateCredentials, credentials, start                                                      |
| `src/server/services/bot/platforms/telegram/helpers.ts`                                 | url, botToken, setTelegramWebhook, secretToken                                               |
| `src/server/services/bot/platforms/types.ts`                                            | ValidationResult                                                                             |
| `src/server/services/desktopRelease/index.ts`                                           | options, getLatestDesktopReleaseFromGithub                                                   |
| `src/server/services/gateway/MessageGatewayClient.ts`                                   | init, path, connectionId, platformThreadId, MessageGatewayStats, ...                         |
| `src/server/services/market/index.ts`                                                   | uploadCredFile, MarketServiceOptions, options, params, getUserInfoWithTrustedClient, ...     |
| `src/server/services/messenger/oauth/slackOAuth.ts`                                     | OAuthV2AccessResponse, exchangeCode, params, refreshToken, RefreshTokenParams, ...           |
| `src/server/services/messenger/platforms/discord/oauth.ts`                              | exchangeCode, params                                                                         |
| `src/server/services/messenger/platforms/slack/binder.ts`                               | req, extractAppHomeOpened, extractCallbackAction, req                                        |
| `src/server/services/oauthDeviceFlow/index.ts`                                          | initiateDeviceCode, config, OAuthDeviceFlowService, pollForToken, deviceCode, ...            |
| `src/server/services/oauthDeviceFlow/providers/githubCopilot.ts`                        | oauthToken, CopilotTokenResponse, GithubUserInfo, GithubCopilotOAuthService, oauthToken, ... |
| `src/server/services/search/impls/anspire/index.ts`                                     | params, apiKey, AnspireImpl, baseUrl, query, ...                                             |
| `src/server/services/search/impls/bocha/index.ts`                                       | apiKey, params, query, baseUrl, BochaImpl, ...                                               |
| `src/server/services/search/impls/brave/index.ts`                                       | apiKey, params, query, query, baseUrl, ...                                                   |
| `src/server/services/search/impls/exa/index.ts`                                         | query, ExaImpl, baseUrl, query, params, ...                                                  |
| `src/server/services/search/impls/firecrawl/index.ts`                                   | apiKey, params, baseUrl, query, query, ...                                                   |
| `src/server/services/search/impls/google/index.ts`                                      | GoogleImpl, baseUrl, engineId, query, apiKey, ...                                            |
| `src/server/services/search/impls/jina/index.ts`                                        | apiKey, query, query, JinaImpl, baseUrl, ...                                                 |
| `src/server/services/search/impls/kagi/index.ts`                                        | query, query, baseUrl, KagiImpl, params, ...                                                 |
| `src/server/services/search/impls/search1api/index.ts`                                  | baseUrl, query, params, apiKey, Search1APIImpl, ...                                          |
| `src/server/services/search/impls/searxng/index.ts`                                     | SearXNGImpl                                                                                  |
| `src/server/services/search/impls/tavily/index.ts`                                      | query, query, baseUrl, apiKey, TavilyImpl, ...                                               |
| `src/server/services/search/impls/type.ts`                                              | SearchServiceImpl                                                                            |
| `src/store/file/slices/document/selectors.ts`                                           | documentId, getDocumentById                                                                  |

## Connected Communities

- **platforms/telegram · call** (1 cross-edges)
- **ssrf-safe-fetch · ssrfSafeFetch · index** (1 cross-edges)
- **platforms/discord · editMessageWithButtons** (1 cross-edges)
- **features/Pages +2 dirs** (1 cross-edges)
- **model-runtime/src · queryOpenAICompatibleVideoStatus** (1 cross-edges)

## How to Explore

```
get_communities with id: "community-4468"
smart_context with task: "understand platforms/telegram +61 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
