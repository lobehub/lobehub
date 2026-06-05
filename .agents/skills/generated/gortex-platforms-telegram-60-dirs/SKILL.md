---
name: gortex-platforms-telegram-60-dirs
description: 'Work in the platforms/telegram +60 dirs area — 263 symbols across 69 files (72% cohesion)'
---

# platforms/telegram +60 dirs

263 symbols | 69 files | 72% cohesion

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
| `apps/cli/src/commands/login.ts`                                                        | T, endpoint, parseJsonResponse, res                                                          |
| `apps/desktop/src/main/controllers/__tests__/AuthCtr.test.ts`                           | json, text                                                                                   |
| `packages/agent-tracing/src/cli/inspect.ts`                                             | url, fetchSnapshotFromUrl                                                                    |
| `packages/chat-adapter-qq/src/adapter.ts`                                               | url, fetchAttachmentData                                                                     |
| `packages/chat-adapter-wechat/src/api.ts`                                               | baseUrl, qrcode, pollQrStatus, QrCodeResponse, fetchQrCode, ...                              |
| `packages/memory-user-memory/benchmarks/locomo/run.ts`                                  | post, main, path, body                                                                       |
| `packages/model-runtime/src/core/anthropicCompatibleFactory/index.ts`                   | createDefaultAnthropicModels                                                                 |
| `packages/model-runtime/src/providers/aihubmix/index.ts`                                | params.models, m, mapAiHubMixModel                                                           |
| `packages/model-runtime/src/providers/cloudflare/index.ts`                              | models                                                                                       |
| `packages/model-runtime/src/providers/comfyui/index.ts`                                 | createImage, options, payload, baseURL, getAuthHeaders, ...                                  |
| `packages/model-runtime/src/providers/nebius/index.test.ts`                             | json                                                                                         |
| `packages/model-runtime/src/providers/nebius/index.ts`                                  | params.models                                                                                |
| `packages/model-runtime/src/providers/straico/index.ts`                                 | name, formatPrice, LobeStraicoAI.models, cleanModelName, pricing                             |
| `packages/model-runtime/src/types/image.ts`                                             | AuthenticatedImageRuntime                                                                    |
| `packages/types/src/aiProvider.ts`                                                      | OAuthDeviceFlowConfig                                                                        |
| `packages/types/src/discover/fork.ts`                                                   | AgentForkBatchResult                                                                         |
| `packages/types/src/tool/search/index.ts`                                               | SearchQuery, UniformSearchResponse, SearchParams                                             |
| `packages/types/src/user/settings/keyVaults.ts`                                         | FalKeyVault                                                                                  |
| `packages/web-crawler/src/crawImpl/naive.ts`                                            | naive, url                                                                                   |
| `scripts/clerk-to-betterauth/export-clerk-users-with-api.ts`                            | fetchClerkApi, secretKey, endpoint, T                                                        |
| `src/app/(backend)/api/auth/[...all]/route.ts`                                          | request, malformedJsonResponse, request, validateJsonBody, POST                              |
| `src/app/(backend)/api/webhooks/casdoor/route.ts`                                       | POST, req                                                                                    |
| `src/app/(backend)/api/webhooks/casdoor/validateRequest.ts`                             | validateRequest, secret, request                                                             |
| `src/app/(backend)/api/webhooks/logto/route.ts`                                         | req, POST                                                                                    |
| `src/app/(backend)/api/webhooks/logto/validateRequest.ts`                               | validateRequest, signingKey, request                                                         |
| `src/app/(backend)/webapi/create-image/comfyui/route.ts`                                | handler, POST, req, req                                                                      |
| `src/app/(backend)/webapi/tts/edge/route.ts`                                            | req, POST                                                                                    |
| `src/app/(backend)/webapi/tts/microsoft/route.ts`                                       | POST, req                                                                                    |
| `src/components/Analytics/ReactScan.tsx`                                                | ReactScanProps                                                                               |
| `src/features/DataImporter/config.ts`                                                   | file, parseConfigFile                                                                        |
| `src/features/ResourceManager/components/Explorer/ItemDropdown/useFileItemDropdown.tsx` | onClick                                                                                      |
| `src/features/ResourceManager/components/Explorer/MasonryView/MasonryItem/index.tsx`    | node, extractFromNode, editorData, fetchContent, extractTextFromEditorJSON                   |
| `src/libs/better-auth/sso/providers/feishu.ts`                                          | getToken, getUserInfo, tokens                                                                |
| `src/libs/better-auth/sso/providers/wechat.ts`                                          | getToken, tokens, getUserInfo                                                                |
| `src/libs/document-loaders/loaders/csv/index.ts`                                        | fileBlob, CsVLoader                                                                          |
| `src/libs/trpc/client/lambda.ts`                                                        | linkOptions.fetch, input, init                                                               |
| `src/libs/trusted-client/index.ts`                                                      | userInfo, generateTrustedClientToken, TrustedClientUserInfo                                  |
| `src/routes/(main)/(create)/image/features/PromptInput/index.tsx`                       | handleGenerate                                                                               |
| `src/routes/(main)/settings/apikey/features/ApiKeyDisplay/index.tsx`                    | ApiKeyDisplayProps                                                                           |
| `src/server/routers/lambda/market/agent.ts`                                             | ForkAgentItemInput, forkOneAgent, headers, ctx, options, ...                                 |
| `src/server/routers/lambda/market/agentGroup.ts`                                        | options, FetchMarketUserInfoOptions, fetchMarketUserInfo                                     |
| `src/server/services/bot/platforms/discord/api.ts`                                      | applicationId, buttons, interactionToken, editInteractionOriginalWithButtons, content        |
| `src/server/services/bot/platforms/discord/client.ts`                                   | credentials, validateCredentials                                                             |
| `src/server/services/bot/platforms/slack/client.ts`                                     | settings, credentials, validateCredentials                                                   |
| `src/server/services/bot/platforms/telegram/api.ts`                                     | attempt, callMultipart, file, method, buildForm, ...                                         |
| `src/server/services/bot/platforms/telegram/client.ts`                                  | start, validateCredentials, credentials                                                      |
| `src/server/services/bot/platforms/telegram/helpers.ts`                                 | setTelegramWebhook, url, botToken, secretToken                                               |
| `src/server/services/bot/platforms/types.ts`                                            | ValidationResult                                                                             |
| `src/server/services/desktopRelease/index.ts`                                           | getLatestDesktopReleaseFromGithub, options                                                   |
| `src/server/services/gateway/MessageGatewayClient.ts`                                   | getStats, MessageGatewayStats, path, fetch, connectionId, ...                                |
| `src/server/services/market/index.ts`                                                   | params, uploadCredFile, constructor, MarketServiceOptions, getUserInfoWithTrustedClient, ... |
| `src/server/services/messenger/oauth/slackOAuth.ts`                                     | token, OAuthV2AccessResponse, params, revokeToken, RefreshTokenParams, ...                   |
| `src/server/services/messenger/platforms/discord/oauth.ts`                              | params, exchangeCode                                                                         |
| `src/server/services/messenger/platforms/slack/binder.ts`                               | extractAppHomeOpened, extractCallbackAction, req, req                                        |
| `src/server/services/oauthDeviceFlow/index.ts`                                          | deviceCode, OAuthDeviceFlowService, pollForToken, config, initiateDeviceCode, ...            |
| `src/server/services/oauthDeviceFlow/providers/githubCopilot.ts`                        | oauthToken, GITHUB_USER_API, deviceCode, providerId, GithubUserInfo, ...                     |
| `src/server/services/search/impls/anspire/index.ts`                                     | query, params, baseUrl, AnspireImpl, apiKey, ...                                             |
| `src/server/services/search/impls/bocha/index.ts`                                       | BochaImpl, baseUrl, params, query, apiKey, ...                                               |
| `src/server/services/search/impls/brave/index.ts`                                       | apiKey, baseUrl, query, BraveImpl, query, ...                                                |
| `src/server/services/search/impls/exa/index.ts`                                         | ExaImpl, baseUrl, params, query, apiKey, ...                                                 |
| `src/server/services/search/impls/firecrawl/index.ts`                                   | FirecrawlImpl, apiKey, params, baseUrl, query, ...                                           |
| `src/server/services/search/impls/google/index.ts`                                      | query, baseUrl, apiKey, params, engineId, ...                                                |
| `src/server/services/search/impls/jina/index.ts`                                        | JinaImpl, apiKey, baseUrl, params, query, ...                                                |
| `src/server/services/search/impls/kagi/index.ts`                                        | KagiImpl, params, baseUrl, apiKey, query, ...                                                |
| `src/server/services/search/impls/search1api/index.ts`                                  | query, query, params, apiKey, Search1APIImpl, ...                                            |
| `src/server/services/search/impls/searxng/index.ts`                                     | SearXNGImpl                                                                                  |
| `src/server/services/search/impls/tavily/index.ts`                                      | query, TavilyImpl, query, params, apiKey, ...                                                |
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
get_communities with id: "community-4462"
smart_context with task: "understand platforms/telegram +60 dirs", format: "gcx"
```

_`format: "gcx"` returns the [GCX1 compact wire format](../../docs/wire-format.md) — round-trippable, \~27% fewer tokens than JSON. Drop it for JSON output; agents using `@gortex/wire` or the Go `github.com/gortexhq/gcx-go` package decode either._
