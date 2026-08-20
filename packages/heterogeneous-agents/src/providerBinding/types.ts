import type { AiProviderRuntimeConfig, HeterogeneousApiConfig } from '@lobechat/types';

import type { LocalHeterogeneousAgentType } from '../config';

export type HeterogeneousProviderBindingProtocol =
  'anthropic-messages' | 'google-generative-ai' | 'openai-chat-completions' | 'openai-responses';

export interface HeterogeneousProviderBindingCapability {
  agentType: LocalHeterogeneousAgentType;
  protocols: readonly HeterogeneousProviderBindingProtocol[];
}

export interface HeterogeneousProviderBindingRuntime {
  enabled: boolean;
  /**
   * Enabled models of the selected provider under the server-resolved scope.
   * Lets Desktop main validate the bound model authoritatively instead of
   * trusting the renderer's (possibly stale) store state.
   */
  enabledModels?: EnabledProviderBindingModelRef[];
  runtimeConfig?: AiProviderRuntimeConfig;
}

export interface HeterogeneousProviderBindingReference {
  apiConfig: HeterogeneousApiConfig;
  /** Binding key stored with the native session that the renderer wants to resume. */
  resumeBindingKey?: string;
}

export interface HeterogeneousProviderBindingResolution {
  agentType: LocalHeterogeneousAgentType;
  apiConfig: HeterogeneousApiConfig;
  /** Credential-free endpoint used by the target CLI. */
  endpoint?: string;
  protocol: HeterogeneousProviderBindingProtocol;
  providerId: string;
  runtimeConfig: AiProviderRuntimeConfig;
}

export type HeterogeneousProviderBindingError =
  | { agentType: string; code: 'agentUnsupported' }
  | { code: 'configMissing' }
  | { code: 'credentialUnsupported'; providerId: string }
  | { code: 'credentialsMissing'; providerId: string }
  | { code: 'endpointMissing'; providerId: string }
  | { code: 'endpointUnsupported'; providerId: string }
  | { code: 'modelUnavailable'; model: string; providerId: string }
  | { agentType: string; code: 'protocolMismatch'; providerId: string }
  | { code: 'providerUnavailable'; providerId: string };

export interface EnabledProviderBindingModelRef {
  id: string;
  providerId: string;
  type: string;
}

export interface ResolveHeterogeneousProviderBindingInput {
  agentType: string;
  apiConfig?: HeterogeneousApiConfig;
  /** Check decrypted credentials. Keep false in renderer/UI and true in Desktop main. */
  checkCredentials?: boolean;
  enabledModels?: readonly EnabledProviderBindingModelRef[];
  providerEnabled: boolean;
  runtimeConfig?: AiProviderRuntimeConfig;
}

export type ResolveHeterogeneousProviderBindingResult =
  | { error: HeterogeneousProviderBindingError; resolution?: never }
  | { error?: never; resolution: HeterogeneousProviderBindingResolution };
