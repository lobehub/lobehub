import { LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';
import urlJoin from 'url-join';

import { responsesAPIModels } from '../../const/models';
import { createRouterRuntime } from '../../core/RouterRuntime';
import type { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';
import { detectModelProvider, processMultiProviderModelList } from '../../utils/modelParse';

export interface NewAPIModelCard {
  created: number;
  id: string;
  object: string;
  owned_by: string;
  supported_endpoint_types?: string[];
}

export interface NewAPIPricing {
  completion_ratio?: number;
  enable_groups: string[];
  model_name: string;
  model_price?: number;
  model_ratio?: number;
  /** 0: Pay-per-token, 1: Pay-per-call */
  quota_type: number;
  supported_endpoint_types?: string[];
}

/**
 * Detect if running in browser environment
 */
const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * Parse a pricing API HTTP response into a `NewAPIPricing[] | null`.
 * Shared between browser and server branches to avoid duplicated logic.
 */
const parsePricingResponse = async (res: Response): Promise<NewAPIPricing[] | null> => {
  if (!res.ok) {
    return null;
  }

  try {
    const body = await res.json();
    return body?.success && body?.data ? (body.data as NewAPIPricing[]) : null;
  } catch {
    return null;
  }
};

/**
 * Fetch pricing information with CORS bypass for client-side requests
 * In browser environment, use /webapi/proxy to avoid CORS errors
 */
const fetchPricing = async (
  pricingUrl: string,
  apiKey: string,
): Promise<NewAPIPricing[] | null> => {
  try {
    if (isBrowser()) {
      // In browser environment, use the proxy endpoint to avoid CORS
      // The proxy endpoint expects the URL as the request body
      const proxyResponse = await fetch('/webapi/proxy', {
        body: pricingUrl,
        method: 'POST',
      });

      return await parsePricingResponse(proxyResponse);
    } else {
      // In server environment, fetch directly
      const pricingResponse = await fetch(pricingUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      return await parsePricingResponse(pricingResponse);
    }
  } catch (error) {
    console.debug('Failed to fetch NewAPI pricing info:', error);
    return null;
  }
};

export const params = {
  debug: {
    chatCompletion: () => process.env.DEBUG_NEWAPI_CHAT_COMPLETION === '1',
  },
  defaultHeaders: {
    'X-Client': 'LobeHub',
  },
  id: ModelProvider.NewAPI,
  models: async ({ client: openAIClient }) => {
    // Get base URL (remove trailing API version paths like /v1, /v1beta, etc.)
    const baseURL = openAIClient.baseURL.replace(/\/v\d+[a-z]*\/?$/, '');

    const modelsPage = (await openAIClient.models.list()) as any;
    const modelList: NewAPIModelCard[] = modelsPage.data || [];

    // Try to get pricing information to enrich model details
    const pricingMap: Map<string, NewAPIPricing> = new Map();

    const pricingList = await fetchPricing(`${baseURL}/api/pricing`, openAIClient.apiKey || '');
    if (pricingList) {
      pricingList.forEach((pricing) => {
        pricingMap.set(pricing.model_name, pricing);
      });
    }

    // Process the model list: determine the provider for each model based on priority rules
    const enrichedModelList = modelList.map((model) => {
      const enhancedModel: any = { ...model };

      // add pricing info
      const pricing = pricingMap.get(model.id);
      if (pricing) {
        // NewAPI pricing calculation logic:
        // - quota_type: 0 means pay-per-token, 1 means pay-per-call
        // - model_ratio: multiplier relative to base price (base price = $0.002/1K tokens)
        // - model_price: directly specified price (takes priority)
        // - completion_ratio: output price multiplier relative to input price
        //
        // LobeChat required format: USD per million tokens

        let inputPrice: number | undefined;
        let outputPrice: number | undefined;

        if (pricing.quota_type === 0) {
          // Pay-per-token
          if (pricing.model_price && pricing.model_price > 0) {
            // model_price is a direct price value; need to confirm its unit.
            // Assumption: model_price is the price per 1,000 tokens (i.e., $/1K tokens).
            // To convert to price per 1,000,000 tokens ($/1M tokens), multiply by 1,000,000 / 1,000 = 1,000.
            // Since the base price is $0.002/1K tokens, multiplying by 2 gives $2/1M tokens.
            // Therefore, inputPrice = model_price * 2 converts the price to $/1M tokens for LobeChat.
            inputPrice = pricing.model_price * 2;
          } else if (pricing.model_ratio) {
            // model_ratio × $0.002/1K = model_ratio × $2/1M
            inputPrice = pricing.model_ratio * 2; // Convert to $/1M tokens
          }

          if (inputPrice !== undefined) {
            // Calculate output price
            outputPrice = inputPrice * (pricing.completion_ratio || 1);

            enhancedModel.pricing = {
              units: [
                {
                  name: 'textInput',
                  rate: inputPrice,
                  strategy: 'fixed',
                  unit: 'millionTokens',
                },
                {
                  name: 'textOutput',
                  rate: outputPrice,
                  strategy: 'fixed',
                  unit: 'millionTokens',
                },
              ],
            };
          }
        }
        // quota_type === 1 pay-per-call is not currently supported
      }

      return enhancedModel;
    });

    return processMultiProviderModelList(enrichedModelList, 'newapi');
  },
  routers: (options) => {
    const userBaseURL = options.baseURL?.replace(/\/v\d+[a-z]*\/?$/, '') || '';

    return [
      {
        apiType: 'anthropic',
        models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
          (id) => detectModelProvider(id) === 'anthropic',
        ),
        options: {
          ...options,
          baseURL: userBaseURL,
        },
      },
      {
        apiType: 'google',
        models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
          (id) => detectModelProvider(id) === 'google',
        ),
        options: {
          ...options,
          baseURL: userBaseURL,
        },
      },
      {
        apiType: 'xai',
        models: LOBE_DEFAULT_MODEL_LIST.map((m) => m.id).filter(
          (id) => detectModelProvider(id) === 'xai',
        ),
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/v1'),
        },
      },
      {
        apiType: 'openai',
        options: {
          ...options,
          baseURL: urlJoin(userBaseURL, '/v1'),
          chatCompletion: {
            useResponseModels: [...Array.from(responsesAPIModels), /gpt-\d(?!\d)/, /^o\d/],
          },
        },
      },
    ];
  },
} satisfies CreateRouterRuntimeOptions;

export const LobeNewAPIAI = createRouterRuntime(params);
