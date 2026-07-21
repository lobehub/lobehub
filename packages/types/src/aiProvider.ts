/**
 * The AI-provider settings / CRUD types are owned by `model-bank` (its
 * provider catalog data is typed by them) — re-exported here so existing
 * `@lobechat/types` / `@/types/aiProvider` imports keep working.
 *
 * Explicit named re-exports on purpose: a blanket `export * from 'model-bank'`
 * through this barrel would collide with sibling files' exports and TypeScript
 * silently DROPS ambiguous `export *` symbols.
 */
export type {
  AiProviderAuthType,
  AiProviderCard,
  AiProviderConfig,
  AiProviderDetailItem,
  AiProviderListItem,
  AiProviderRuntimeConfig,
  AiProviderRuntimeState,
  AiProviderSDKType,
  AiProviderSettings,
  AiProviderSortMap,
  AiProviderSourceType,
  CreateAiProviderParams,
  EnabledProvider,
  EnabledProviderWithModels,
  OAuthDeviceFlowConfig,
  OAuthDeviceFlowKeyVault,
  ResponseAnimation,
  ResponseAnimationStyle,
  UpdateAiProviderConfigParams,
  UpdateAiProviderParams,
} from 'model-bank';
export {
  AiProviderAuthTypeEnum,
  AiProviderSDKEnum,
  AiProviderSourceEnum,
  CreateAiProviderSchema,
  UpdateAiProviderConfigSchema,
  UpdateAiProviderSchema,
} from 'model-bank';
