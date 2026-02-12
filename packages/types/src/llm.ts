import type { AiModelSettings, AiModelType, ModelParamsSchema, Pricing } from 'model-bank';
import type { ReactNode } from 'react';

import type { AiProviderSettings } from './aiProvider';

export interface ChatModelCard {
  /**
   * the context window (or input + output tokens limit)
   */
  contextWindowTokens?: number;
  /**
   * only used in azure
   */
  deploymentName?: string;
  description?: string;
  /**
   * the name show for end user
   */
  displayName?: string;
  /**
   * whether model is enabled by default
   */
  enabled?: boolean;
  /**
   * whether model supports file upload
   */
  files?: boolean;
  /**
   * whether model supports function call
   */
  functionCall?: boolean;
  id: string;

  /**
   *  whether model supports imageOutput
   */
  imageOutput?: boolean;

  /**
   * whether model is custom
   */
  isCustom?: boolean;
  /**
   * whether model is legacy (deprecated but not removed yet)
   */
  legacy?: boolean;
  maxOutput?: number;
  parameters?: ModelParamsSchema;

  pricing?: Pricing;

  /**
   *  whether model supports reasoning
   */
  reasoning?: boolean;

  /**
   * the date when model is released
   */
  releasedAt?: string;

  /**
   *  whether model supports search
   */
  search?: boolean;

  settings?: AiModelSettings;

  type?: AiModelType;

  /**
   *  whether model supports video
   */
  video?: boolean;

  /**
   *  whether model supports vision
   */
  vision?: boolean;
}

export interface ModelProviderCard {
  /**
   * url to get api key
   */
  apiKeyUrl?: string;
  /**
   * @deprecated
   */
  chatModels: ChatModelCard[];
  /**
   * the default model that used for connection check
   */
  checkModel?: string;
  /**
   * whether provider show browser request option by default
   * @deprecated
   * @default false
   */
  defaultShowBrowserRequest?: boolean;
  description?: string;
  /**
   * some provider server like stepfun and aliyun don't support browser request,
   * So we should disable it
   * @deprecated
   * @default false
   */
  disableBrowserRequest?: boolean;
  /**
   * whether provider is enabled by default
   */
  enabled?: boolean;
  id: string;
  /**
   * @deprecated
   */
  modelList?: {
    azureDeployName?: boolean;
    notFoundContent?: ReactNode;
    placeholder?: string;
    showModelFetcher?: boolean;
  };
  /**
   * the url show the all models in the provider
   */
  modelsUrl?: string;
  /**
   * the name show for end user
   */
  name: string;
  /**
   * @deprecated
   */
  proxyUrl?:
    | {
        desc?: string;
        placeholder: string;
        title?: string;
      }
    | false;

  settings: AiProviderSettings;
  /**
   * whether show api key in the provider config
   * so provider like ollama don't need api key field
   * @deprecated
   */
  showApiKey?: boolean;
  /**
   * whether show checker in the provider config
   * @deprecated
   */
  showChecker?: boolean;
  /**
   * whether to show the provider config
   */
  showConfig?: boolean;
  /**
   * provider's website url
   */
  url: string;
}

export type LLMRoleType = 'user' | 'system' | 'assistant' | 'tool';

export interface LLMMessage {
  content: string;
  role: LLMRoleType;
}

export type FewShots = LLMMessage[];
