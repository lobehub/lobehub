/* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const getLLMConfig = () => {
  return createEnv({
    server: {
      API_KEY_SELECT_MODE: z.string().optional(),

      ENABLED_OPENAI: z.boolean(),
      OPENAI_API_KEY: z.string().optional(),

      ENABLED_AZURE_OPENAI: z.boolean(),
      AZURE_API_KEY: z.string().optional(),
      AZURE_API_VERSION: z.string().optional(),
      AZURE_ENDPOINT: z.string().optional(),

      ENABLED_AZUREAI: z.boolean(),
      AZUREAI_ENDPOINT: z.string().optional(),
      AZUREAI_ENDPOINT_KEY: z.string().optional(),

      ENABLED_ZHIPU: z.boolean(),
      ZHIPU_API_KEY: z.string().optional(),

      ENABLED_DEEPSEEK: z.boolean(),
      DEEPSEEK_API_KEY: z.string().optional(),

      ENABLED_GOOGLE: z.boolean(),
      GOOGLE_API_KEY: z.string().optional(),

      ENABLED_MOONSHOT: z.boolean(),
      MOONSHOT_API_KEY: z.string().optional(),

      ENABLED_PERPLEXITY: z.boolean(),
      PERPLEXITY_API_KEY: z.string().optional(),

      ENABLED_ANTHROPIC: z.boolean(),
      ANTHROPIC_API_KEY: z.string().optional(),

      ENABLED_MINIMAX: z.boolean(),
      MINIMAX_API_KEY: z.string().optional(),

      ENABLED_MISTRAL: z.boolean(),
      MISTRAL_API_KEY: z.string().optional(),

      ENABLED_GROQ: z.boolean(),
      GROQ_API_KEY: z.string().optional(),

      ENABLED_GITHUB: z.boolean(),
      GITHUB_TOKEN: z.string().optional(),

      ENABLED_OPENROUTER: z.boolean(),
      OPENROUTER_API_KEY: z.string().optional(),

      ENABLED_ZEROONE: z.boolean(),
      ZEROONE_API_KEY: z.string().optional(),

      ENABLED_TOGETHERAI: z.boolean(),
      TOGETHERAI_API_KEY: z.string().optional(),

      ENABLED_FIREWORKSAI: z.boolean(),
      FIREWORKSAI_API_KEY: z.string().optional(),

      ENABLED_AWS_BEDROCK: z.boolean(),
      AWS_REGION: z.string().optional(),
      AWS_ACCESS_KEY_ID: z.string().optional(),
      AWS_SECRET_ACCESS_KEY: z.string().optional(),
      AWS_SESSION_TOKEN: z.string().optional(),

      ENABLED_WENXIN: z.boolean(),
      WENXIN_API_KEY: z.string().optional(),

      ENABLED_OLLAMA: z.boolean(),
      ENABLED_OLLAMA_CLOUD: z.boolean(),
      OLLAMA_CLOUD_API_KEY: z.string().optional(),

      ENABLED_VLLM: z.boolean(),
      VLLM_API_KEY: z.string().optional(),

      ENABLED_XINFERENCE: z.boolean(),
      XINFERENCE_API_KEY: z.string().optional(),

      ENABLED_QINIU: z.boolean(),
      QINIU_API_KEY: z.string().optional(),

      ENABLED_QWEN: z.boolean(),
      QWEN_API_KEY: z.string().optional(),

      ENABLED_STEPFUN: z.boolean(),
      STEPFUN_API_KEY: z.string().optional(),

      ENABLED_NEBIUS: z.boolean(),
      NEBIUS_API_KEY: z.string().optional(),

      ENABLED_NOVITA: z.boolean(),
      NOVITA_API_KEY: z.string().optional(),

      ENABLED_NVIDIA: z.boolean(),
      NVIDIA_API_KEY: z.string().optional(),

      ENABLED_BAICHUAN: z.boolean(),
      BAICHUAN_API_KEY: z.string().optional(),

      ENABLED_TAICHU: z.boolean(),
      TAICHU_API_KEY: z.string().optional(),

      ENABLED_CLOUDFLARE: z.boolean(),
      CLOUDFLARE_API_KEY: z.string().optional(),
      CLOUDFLARE_BASE_URL_OR_ACCOUNT_ID: z.string().optional(),

      ENABLED_AI360: z.boolean(),
      AI360_API_KEY: z.string().optional(),

      ENABLED_SILICONCLOUD: z.boolean(),
      SILICONCLOUD_API_KEY: z.string().optional(),

      ENABLED_GITEE_AI: z.boolean(),
      GITEE_AI_API_KEY: z.string().optional(),

      ENABLED_UPSTAGE: z.boolean(),
      UPSTAGE_API_KEY: z.string().optional(),

      ENABLED_SPARK: z.boolean(),
      SPARK_API_KEY: z.string().optional(),

      ENABLED_AI21: z.boolean(),
      AI21_API_KEY: z.string().optional(),

      ENABLED_HUNYUAN: z.boolean(),
      HUNYUAN_API_KEY: z.string().optional(),

      ENABLED_HUGGINGFACE: z.boolean(),
      HUGGINGFACE_API_KEY: z.string().optional(),

      ENABLED_SENSENOVA: z.boolean(),
      SENSENOVA_API_KEY: z.string().optional(),

      ENABLED_XAI: z.boolean(),
      XAI_API_KEY: z.string().optional(),

      ENABLED_INTERNLM: z.boolean(),
      INTERNLM_API_KEY: z.string().optional(),

      ENABLED_HIGRESS: z.boolean(),
      HIGRESS_API_KEY: z.string().optional(),

      ENABLED_VOLCENGINE: z.boolean(),
      VOLCENGINE_API_KEY: z.string().optional(),

      ENABLED_TENCENT_CLOUD: z.boolean(),
      TENCENT_CLOUD_API_KEY: z.string().optional(),

      ENABLED_JINA: z.boolean(),
      JINA_API_KEY: z.string().optional(),

      ENABLED_SAMBANOVA: z.boolean(),
      SAMBANOVA_API_KEY: z.string().optional(),

      ENABLED_PPIO: z.boolean(),
      PPIO_API_KEY: z.string().optional(),

      ENABLED_SEARCH1API: z.boolean(),
      SEARCH1API_API_KEY: z.string().optional(),

      ENABLED_COHERE: z.boolean(),
      COHERE_API_KEY: z.string().optional(),

      ENABLED_INFINIAI: z.boolean(),
      INFINIAI_API_KEY: z.string().optional(),

      ENABLED_FAL: z.boolean(),
      FAL_API_KEY: z.string().optional(),

      ENABLED_BFL: z.boolean(),
      BFL_API_KEY: z.string().optional(),

      ENABLED_COMFYUI: z.boolean(),
      COMFYUI_BASE_URL: z.string().optional(),
      COMFYUI_AUTH_TYPE: z.string().optional(),
      COMFYUI_API_KEY: z.string().optional(),
      COMFYUI_USERNAME: z.string().optional(),
      COMFYUI_PASSWORD: z.string().optional(),
      COMFYUI_CUSTOM_HEADERS: z.string().optional(),

      ENABLED_MODELSCOPE: z.boolean(),
      MODELSCOPE_API_KEY: z.string().optional(),

      ENABLED_V0: z.boolean(),
      V0_API_KEY: z.string().optional(),

      ENABLED_VERCELAIGATEWAY: z.boolean(),
      VERCELAIGATEWAY_API_KEY: z.string().optional(),

      ENABLED_AI302: z.boolean(),
      AI302_API_KEY: z.string().optional(),

      ENABLED_AKASHCHAT: z.boolean(),
      AKASHCHAT_API_KEY: z.string().optional(),

      ENABLED_COMETAPI: z.boolean(),
      COMETAPI_KEY: z.string().optional(),

      ENABLED_AIHUBMIX: z.boolean(),
      AIHUBMIX_API_KEY: z.string().optional(),

      ENABLED_NEWAPI: z.boolean(),
      NEWAPI_API_KEY: z.string().optional(),
      NEWAPI_PROXY_URL: z.string().optional(),

      ENABLED_CEREBRAS: z.boolean(),
      CEREBRAS_API_KEY: z.string().optional(),
    },
    runtimeEnv: {
      API_KEY_SELECT_MODE: process.env.API_KEY_SELECT_MODE,

      ENABLED_OPENAI: process.env.ENABLED_OPENAI !== '0',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,

      ENABLED_AZURE_OPENAI: !!process.env.AZURE_API_KEY,
      AZURE_API_KEY: process.env.AZURE_API_KEY,
      AZURE_API_VERSION: process.env.AZURE_API_VERSION,
      AZURE_ENDPOINT: process.env.AZURE_ENDPOINT,

      ENABLED_AZUREAI: !!process.env.AZUREAI_ENDPOINT_KEY,
      AZUREAI_ENDPOINT_KEY: process.env.AZUREAI_ENDPOINT_KEY,
      AZUREAI_ENDPOINT: process.env.AZUREAI_ENDPOINT,

      ENABLED_ZHIPU: !!process.env.ZHIPU_API_KEY,
      ZHIPU_API_KEY: process.env.ZHIPU_API_KEY,

      ENABLED_DEEPSEEK: !!process.env.DEEPSEEK_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,

      ENABLED_GOOGLE: !!process.env.GOOGLE_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,

      ENABLED_VOLCENGINE: !!process.env.VOLCENGINE_API_KEY,
      VOLCENGINE_API_KEY: process.env.VOLCENGINE_API_KEY,

      ENABLED_PERPLEXITY: !!process.env.PERPLEXITY_API_KEY,
      PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,

      ENABLED_ANTHROPIC: !!process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,

      ENABLED_MINIMAX: !!process.env.MINIMAX_API_KEY,
      MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,

      ENABLED_MISTRAL: !!process.env.MISTRAL_API_KEY,
      MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,

      ENABLED_OPENROUTER: !!process.env.OPENROUTER_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,

      ENABLED_TOGETHERAI: !!process.env.TOGETHERAI_API_KEY,
      TOGETHERAI_API_KEY: process.env.TOGETHERAI_API_KEY,

      ENABLED_FIREWORKSAI: !!process.env.FIREWORKSAI_API_KEY,
      FIREWORKSAI_API_KEY: process.env.FIREWORKSAI_API_KEY,

      ENABLED_MOONSHOT: !!process.env.MOONSHOT_API_KEY,
      MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY,

      ENABLED_GROQ: !!process.env.GROQ_API_KEY,
      GROQ_API_KEY: process.env.GROQ_API_KEY,

      ENABLED_GITHUB: !!process.env.GITHUB_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,

      ENABLED_ZEROONE: !!process.env.ZEROONE_API_KEY,
      ZEROONE_API_KEY: process.env.ZEROONE_API_KEY,

      ENABLED_AWS_BEDROCK: process.env.ENABLED_AWS_BEDROCK === '1',
      AWS_REGION: process.env.AWS_REGION,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,

      ENABLED_WENXIN: !!process.env.WENXIN_API_KEY,
      WENXIN_API_KEY: process.env.WENXIN_API_KEY,

      ENABLED_OLLAMA: process.env.ENABLED_OLLAMA !== '0',
      ENABLED_OLLAMA_CLOUD: !!process.env.OLLAMA_CLOUD_API_KEY,
      OLLAMA_CLOUD_API_KEY: process.env.OLLAMA_CLOUD_API_KEY,

      ENABLED_VLLM: !!process.env.VLLM_API_KEY,
      VLLM_API_KEY: process.env.VLLM_API_KEY,

      ENABLED_XINFERENCE: !!process.env.XINFERENCE_API_KEY,
      XINFERENCE_API_KEY: process.env.XINFERENCE_API_KEY,

      ENABLED_QINIU: !!process.env.QINIU_API_KEY,
      QINIU_API_KEY: process.env.QINIU_API_KEY,

      ENABLED_QWEN: !!process.env.QWEN_API_KEY,
      QWEN_API_KEY: process.env.QWEN_API_KEY,

      ENABLED_STEPFUN: !!process.env.STEPFUN_API_KEY,
      STEPFUN_API_KEY: process.env.STEPFUN_API_KEY,

      ENABLED_NOVITA: !!process.env.NOVITA_API_KEY,
      NOVITA_API_KEY: process.env.NOVITA_API_KEY,

      ENABLED_NVIDIA: !!process.env.NVIDIA_API_KEY,
      NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,

      ENABLED_BAICHUAN: !!process.env.BAICHUAN_API_KEY,
      BAICHUAN_API_KEY: process.env.BAICHUAN_API_KEY,

      ENABLED_TAICHU: !!process.env.TAICHU_API_KEY,
      TAICHU_API_KEY: process.env.TAICHU_API_KEY,

      ENABLED_CLOUDFLARE:
        !!process.env.CLOUDFLARE_API_KEY && !!process.env.CLOUDFLARE_BASE_URL_OR_ACCOUNT_ID,
      CLOUDFLARE_API_KEY: process.env.CLOUDFLARE_API_KEY,
      CLOUDFLARE_BASE_URL_OR_ACCOUNT_ID: process.env.CLOUDFLARE_BASE_URL_OR_ACCOUNT_ID,

      ENABLED_AI360: !!process.env.AI360_API_KEY,
      AI360_API_KEY: process.env.AI360_API_KEY,

      ENABLED_SILICONCLOUD: !!process.env.SILICONCLOUD_API_KEY,
      SILICONCLOUD_API_KEY: process.env.SILICONCLOUD_API_KEY,

      ENABLED_GITEE_AI: !!process.env.GITEE_AI_API_KEY,
      GITEE_AI_API_KEY: process.env.GITEE_AI_API_KEY,

      ENABLED_UPSTAGE: !!process.env.UPSTAGE_API_KEY,
      UPSTAGE_API_KEY: process.env.UPSTAGE_API_KEY,

      ENABLED_SPARK: !!process.env.SPARK_API_KEY,
      SPARK_API_KEY: process.env.SPARK_API_KEY,

      ENABLED_AI21: !!process.env.AI21_API_KEY,
      AI21_API_KEY: process.env.AI21_API_KEY,

      ENABLED_HUNYUAN: !!process.env.HUNYUAN_API_KEY,
      HUNYUAN_API_KEY: process.env.HUNYUAN_API_KEY,

      ENABLED_HUGGINGFACE: !!process.env.HUGGINGFACE_API_KEY,
      HUGGINGFACE_API_KEY: process.env.HUGGINGFACE_API_KEY,

      ENABLED_SENSENOVA: !!process.env.SENSENOVA_API_KEY,
      SENSENOVA_API_KEY: process.env.SENSENOVA_API_KEY,

      ENABLED_XAI: !!process.env.XAI_API_KEY,
      XAI_API_KEY: process.env.XAI_API_KEY,

      ENABLED_INTERNLM: !!process.env.INTERNLM_API_KEY,
      INTERNLM_API_KEY: process.env.INTERNLM_API_KEY,

      ENABLED_HIGRESS: !!process.env.HIGRESS_API_KEY,
      HIGRESS_API_KEY: process.env.HIGRESS_API_KEY,

      ENABLED_TENCENT_CLOUD: !!process.env.TENCENT_CLOUD_API_KEY,
      TENCENT_CLOUD_API_KEY: process.env.TENCENT_CLOUD_API_KEY,

      ENABLED_JINA: !!process.env.JINA_API_KEY,
      JINA_API_KEY: process.env.JINA_API_KEY,

      ENABLED_SAMBANOVA: !!process.env.SAMBANOVA_API_KEY,
      SAMBANOVA_API_KEY: process.env.SAMBANOVA_API_KEY,

      ENABLED_PPIO: !!process.env.PPIO_API_KEY,
      PPIO_API_KEY: process.env.PPIO_API_KEY,

      ENABLED_SEARCH1API: !!process.env.SEARCH1API_API_KEY,
      SEARCH1API_API_KEY: process.env.SEARCH1API_API_KEY,

      ENABLED_COHERE: !!process.env.COHERE_API_KEY,
      COHERE_API_KEY: process.env.COHERE_API_KEY,

      ENABLED_INFINIAI: !!process.env.INFINIAI_API_KEY,
      INFINIAI_API_KEY: process.env.INFINIAI_API_KEY,

      ENABLED_FAL: process.env.ENABLED_FAL !== '0',
      FAL_API_KEY: process.env.FAL_API_KEY,

      ENABLED_BFL: !!process.env.BFL_API_KEY,
      BFL_API_KEY: process.env.BFL_API_KEY,

      ENABLED_COMFYUI: process.env.ENABLED_COMFYUI !== '0',
      COMFYUI_BASE_URL: process.env.COMFYUI_BASE_URL,
      COMFYUI_AUTH_TYPE: process.env.COMFYUI_AUTH_TYPE,
      COMFYUI_API_KEY: process.env.COMFYUI_API_KEY,
      COMFYUI_USERNAME: process.env.COMFYUI_USERNAME,
      COMFYUI_PASSWORD: process.env.COMFYUI_PASSWORD,
      COMFYUI_CUSTOM_HEADERS: process.env.COMFYUI_CUSTOM_HEADERS,

      ENABLED_MODELSCOPE: !!process.env.MODELSCOPE_API_KEY,
      MODELSCOPE_API_KEY: process.env.MODELSCOPE_API_KEY,

      ENABLED_V0: !!process.env.V0_API_KEY,
      V0_API_KEY: process.env.V0_API_KEY,

      ENABLED_VERCELAIGATEWAY: !!process.env.VERCELAIGATEWAY_API_KEY,
      VERCELAIGATEWAY_API_KEY: process.env.VERCELAIGATEWAY_API_KEY,

      ENABLED_AI302: !!process.env.AI302_API_KEY,
      AI302_API_KEY: process.env.AI302_API_KEY,

      ENABLED_AKASHCHAT: !!process.env.AKASHCHAT_API_KEY,
      AKASHCHAT_API_KEY: process.env.AKASHCHAT_API_KEY,

      ENABLED_COMETAPI: !!process.env.COMETAPI_KEY,
      COMETAPI_KEY: process.env.COMETAPI_KEY,

      ENABLED_AIHUBMIX: !!process.env.AIHUBMIX_API_KEY,
      AIHUBMIX_API_KEY: process.env.AIHUBMIX_API_KEY,

      ENABLED_NEWAPI: !!process.env.NEWAPI_API_KEY,
      NEWAPI_API_KEY: process.env.NEWAPI_API_KEY,
      NEWAPI_PROXY_URL: process.env.NEWAPI_PROXY_URL,

      ENABLED_NEBIUS: !!process.env.NEBIUS_API_KEY,
      NEBIUS_API_KEY: process.env.NEBIUS_API_KEY,

      ENABLED_CEREBRAS: !!process.env.CEREBRAS_API_KEY,
      CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
    },
  });
};

export const llmEnv = getLLMConfig();
