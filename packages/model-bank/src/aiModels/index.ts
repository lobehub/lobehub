import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';

import type { AiFullModelCard, LobeDefaultAiModelListItem } from '../types/aiModel';
import { default as ai21 } from './ai21';
import { default as ai302 } from './ai302';
import { default as ai360 } from './ai360';
import { default as aihubmix } from './aihubmix';
import { default as akashchat } from './akashchat';
import { default as anthropic } from './anthropic';
import { default as azure } from './azure';
import { default as azureai } from './azureai';
import { default as baichuan } from './baichuan';
import { default as bedrock } from './bedrock';
import { default as bfl } from './bfl';
import { default as cerebras } from './cerebras';
import { default as cloudflare } from './cloudflare';
import { default as cohere } from './cohere';
import { default as cometapi } from './cometapi';
import { default as comfyui } from './comfyui';
import { default as deepseek } from './deepseek';
import { default as fal } from './fal';
import { default as fireworksai } from './fireworksai';
import { default as giteeai } from './giteeai';
import { default as github } from './github';
import { default as githubcopilot } from './githubCopilot';
import { default as google } from './google';
import { default as groq } from './groq';
import { default as higress } from './higress';
import { default as huggingface } from './huggingface';
import { default as hunyuan } from './hunyuan';
import { default as infiniai } from './infiniai';
import { default as internlm } from './internlm';
import { default as jina } from './jina';
import { default as lmstudio } from './lmstudio';
import { default as lobehub } from './lobehub/index';
import { default as minimax } from './minimax';
import { default as mistral } from './mistral';
import { default as modelscope } from './modelscope';
import { default as moonshot } from './moonshot';
import { default as nebius } from './nebius';
import { default as newapi } from './newapi';
import { default as novita } from './novita';
import { default as nvidia } from './nvidia';
import { default as ollama } from './ollama';
import { default as ollamacloud } from './ollamacloud';
import { default as openai } from './openai';
import { default as openrouter } from './openrouter';
import { default as perplexity } from './perplexity';
import { default as ppio } from './ppio';
import { default as qiniu } from './qiniu';
import { default as qwen } from './qwen';
import { default as replicate } from './replicate';
import { default as sambanova } from './sambanova';
import { default as search1api } from './search1api';
import { default as sensenova } from './sensenova';
import { default as siliconcloud } from './siliconcloud';
import { default as spark } from './spark';
import { default as stepfun } from './stepfun';
import { default as taichu } from './taichu';
import { default as tencentcloud } from './tencentcloud';
import { default as togetherai } from './togetherai';
import { default as upstage } from './upstage';
import { default as v0 } from './v0';
import { default as vercelaigateway } from './vercelaigateway';
import { default as vertexai } from './vertexai';
import { default as vllm } from './vllm';
import { default as volcengine } from './volcengine';
import { default as wenxin } from './wenxin';
import { default as xai } from './xai';
import { default as xiaomimimo } from './xiaomimimo';
import { default as xinference } from './xinference';
import { default as zenmux } from './zenmux';
import { default as zeroone } from './zeroone';
import { default as zhipu } from './zhipu';

type ModelsMap = Record<string, AiFullModelCard[]>;

const buildDefaultModelList = (map: ModelsMap): LobeDefaultAiModelListItem[] => {
  let models: LobeDefaultAiModelListItem[] = [];

  Object.entries(map).forEach(([provider, providerModels]) => {
    const newModels = providerModels.map((model) => ({
      ...model,
      abilities: model.abilities ?? {},
      enabled: model.enabled || false,
      providerId: provider,
      source: 'builtin',
    }));
    models = models.concat(newModels);
  });

  return models;
};

export const LOBE_DEFAULT_MODEL_LIST = buildDefaultModelList({
  ai21,
  ai302,
  ai360,
  aihubmix,
  akashchat,
  anthropic,
  azure,
  azureai,
  baichuan,
  bedrock,
  bfl,
  cerebras,
  cloudflare,
  cohere,
  cometapi,
  comfyui,
  deepseek,
  fal,
  fireworksai,
  giteeai,
  github,
  githubcopilot,
  google,
  groq,
  higress,
  huggingface,
  hunyuan,
  infiniai,
  internlm,
  jina,
  lmstudio,
  ...(ENABLE_BUSINESS_FEATURES ? { lobehub } : {}),
  minimax,
  mistral,
  modelscope,
  moonshot,
  nebius,
  newapi,
  novita,
  nvidia,
  ollama,
  ollamacloud,
  openai,
  openrouter,
  perplexity,
  ppio,
  qiniu,
  qwen,
  replicate,
  sambanova,
  search1api,
  sensenova,
  siliconcloud,
  spark,
  stepfun,
  taichu,
  tencentcloud,
  togetherai,
  upstage,
  v0,
  vercelaigateway,
  vertexai,
  vllm,
  volcengine,
  wenxin,
  xai,
  xiaomimimo,
  xinference,
  zenmux,
  zeroone,
  zhipu,
});

export { default as ai21 } from './ai21';
export { default as ai302 } from './ai302';
export { default as ai360 } from './ai360';
export { default as aihubmix } from './aihubmix';
export { default as akashchat } from './akashchat';
export { default as anthropic } from './anthropic';
export { default as azure } from './azure';
export { default as azureai } from './azureai';
export { default as baichuan } from './baichuan';
export { default as bedrock } from './bedrock';
export { default as bfl } from './bfl';
export { default as cerebras } from './cerebras';
export { default as cloudflare } from './cloudflare';
export { default as cohere } from './cohere';
export { default as cometapi } from './cometapi';
export { default as comfyui } from './comfyui';
export { default as deepseek } from './deepseek';
export { default as fal, fluxSchnellParamsSchema } from './fal';
export { default as fireworksai } from './fireworksai';
export { default as giteeai } from './giteeai';
export { default as github } from './github';
export { default as githubcopilot } from './githubCopilot';
export { default as google } from './google';
export { default as groq } from './groq';
export { default as higress } from './higress';
export { default as huggingface } from './huggingface';
export { default as hunyuan } from './hunyuan';
export { default as infiniai } from './infiniai';
export { default as internlm } from './internlm';
export { default as jina } from './jina';
export { default as lmstudio } from './lmstudio';
export { default as lobehub } from './lobehub/index';
export { default as minimax } from './minimax';
export { default as mistral } from './mistral';
export { default as modelscope } from './modelscope';
export { default as moonshot } from './moonshot';
export { default as nebius } from './nebius';
export { default as newapi } from './newapi';
export { default as novita } from './novita';
export { default as nvidia } from './nvidia';
export { default as ollama } from './ollama';
export { default as ollamacloud } from './ollamacloud';
export { gptImage1ParamsSchema, default as openai, openaiChatModels } from './openai';
export { default as openrouter } from './openrouter';
export { default as perplexity } from './perplexity';
export { default as ppio } from './ppio';
export { default as qiniu } from './qiniu';
export { default as qwen } from './qwen';
export { default as replicate } from './replicate';
export { default as sambanova } from './sambanova';
export { default as search1api } from './search1api';
export { default as sensenova } from './sensenova';
export { default as siliconcloud } from './siliconcloud';
export { default as spark } from './spark';
export { default as stepfun } from './stepfun';
export { default as taichu } from './taichu';
export { default as tencentcloud } from './tencentcloud';
export { default as togetherai } from './togetherai';
export { default as upstage } from './upstage';
export { default as v0 } from './v0';
export { default as vercelaigateway } from './vercelaigateway';
export { default as vertexai } from './vertexai';
export { default as vllm } from './vllm';
export { default as volcengine } from './volcengine';
export { default as wenxin } from './wenxin';
export { default as xai } from './xai';
export { default as xiaomimimo } from './xiaomimimo';
export { default as xinference } from './xinference';
export { default as zenmux } from './zenmux';
export { default as zeroone } from './zeroone';
export { default as zhipu } from './zhipu';
