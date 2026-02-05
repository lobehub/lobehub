import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';

import type { AiFullModelCard, LobeDefaultAiModelListItem } from '../types/aiModel';
import ai21 from './ai21';
import ai302 from './ai302';
import ai360 from './ai360';
import aihubmix from './aihubmix';
import akashchat from './akashchat';
import anthropic from './anthropic';
import azure from './azure';
import azureai from './azureai';
import baichuan from './baichuan';
import bedrock from './bedrock';
import bfl from './bfl';
import cerebras from './cerebras';
import cloudflare from './cloudflare';
import cohere from './cohere';
import cometapi from './cometapi';
import comfyui from './comfyui';
import deepseek from './deepseek';
import fal from './fal';
import fireworksai from './fireworksai';
import giteeai from './giteeai';
import github from './github';
import githubcopilot from './githubCopilot';
import google from './google';
import groq from './groq';
import higress from './higress';
import huggingface from './huggingface';
import hunyuan from './hunyuan';
import infiniai from './infiniai';
import internlm from './internlm';
import jina from './jina';
import lmstudio from './lmstudio';
import lobehub from './lobehub/index';
import minimax from './minimax';
import mistral from './mistral';
import modelscope from './modelscope';
import moonshot from './moonshot';
import nebius from './nebius';
import newapi from './newapi';
import novita from './novita';
import nvidia from './nvidia';
import ollama from './ollama';
import ollamacloud from './ollamacloud';
import openai from './openai';
import openrouter from './openrouter';
import perplexity from './perplexity';
import ppio from './ppio';
import qiniu from './qiniu';
import qwen from './qwen';
import replicate from './replicate';
import sambanova from './sambanova';
import search1api from './search1api';
import sensenova from './sensenova';
import siliconcloud from './siliconcloud';
import spark from './spark';
import stepfun from './stepfun';
import taichu from './taichu';
import tencentcloud from './tencentcloud';
import togetherai from './togetherai';
import upstage from './upstage';
import v0 from './v0';
import vercelaigateway from './vercelaigateway';
import vertexai from './vertexai';
import vllm from './vllm';
import volcengine from './volcengine';
import wenxin from './wenxin';
import xai from './xai';
import xiaomimimo from './xiaomimimo';
import xinference from './xinference';
import zenmux from './zenmux';
import zeroone from './zeroone';
import zhipu from './zhipu';

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
