import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';

import type { ChatModelCard, ModelProviderCard } from '@/types/llm';

import Ai21Provider from './ai21';
import Ai302Provider from './ai302';
import Ai360Provider from './ai360';
import AiHubMixProvider from './aihubmix';
import AkashChatProvider from './akashchat';
import AnthropicProvider from './anthropic';
import AzureProvider from './azure';
import AzureAIProvider from './azureai';
import BaichuanProvider from './baichuan';
import BedrockProvider from './bedrock';
import BflProvider from './bfl';
import CerebrasProvider from './cerebras';
import CloudflareProvider from './cloudflare';
import CohereProvider from './cohere';
import CometAPIProvider from './cometapi';
import ComfyUIProvider from './comfyui';
import DeepSeekProvider from './deepseek';
import FalProvider from './fal';
import FireworksAIProvider from './fireworksai';
import GiteeAIProvider from './giteeai';
import GithubProvider from './github';
import GithubCopilotProvider from './githubCopilot';
import GoogleProvider from './google';
import GroqProvider from './groq';
import HigressProvider from './higress';
import HuggingFaceProvider from './huggingface';
import HunyuanProvider from './hunyuan';
import InfiniAIProvider from './infiniai';
import InternLMProvider from './internlm';
import JinaProvider from './jina';
import LMStudioProvider from './lmstudio';
import LobeHubProvider from './lobehub';
import MinimaxProvider from './minimax';
import MistralProvider from './mistral';
import ModelScopeProvider from './modelscope';
import MoonshotProvider from './moonshot';
import NebiusProvider from './nebius';
import NewAPIProvider from './newapi';
import NovitaProvider from './novita';
import NvidiaProvider from './nvidia';
import OllamaProvider from './ollama';
import OllamaCloudProvider from './ollamacloud';
import OpenAIProvider from './openai';
import OpenRouterProvider from './openrouter';
import PerplexityProvider from './perplexity';
import PPIOProvider from './ppio';
import QiniuProvider from './qiniu';
import QwenProvider from './qwen';
import ReplicateProvider from './replicate';
import SambaNovaProvider from './sambanova';
import Search1APIProvider from './search1api';
import SenseNovaProvider from './sensenova';
import SiliconCloudProvider from './siliconcloud';
import SparkProvider from './spark';
import StepfunProvider from './stepfun';
import TaichuProvider from './taichu';
import TencentcloudProvider from './tencentcloud';
import TogetherAIProvider from './togetherai';
import UpstageProvider from './upstage';
import V0Provider from './v0';
import VercelAIGatewayProvider from './vercelaigateway';
import VertexAIProvider from './vertexai';
import VLLMProvider from './vllm';
import VolcengineProvider from './volcengine';
import WenxinProvider from './wenxin';
import XAIProvider from './xai';
import XiaomiMiMoProvider from './xiaomimimo';
import XinferenceProvider from './xinference';
import ZenMuxProvider from './zenmux';
import ZeroOneProvider from './zeroone';
import ZhiPuProvider from './zhipu';

/**
 * @deprecated
 */
export const LOBE_DEFAULT_MODEL_LIST: ChatModelCard[] = [
  OpenAIProvider.chatModels,
  QwenProvider.chatModels,
  ZhiPuProvider.chatModels,
  BedrockProvider.chatModels,
  DeepSeekProvider.chatModels,
  GoogleProvider.chatModels,
  GroqProvider.chatModels,
  GithubProvider.chatModels,
  MinimaxProvider.chatModels,
  MistralProvider.chatModels,
  ModelScopeProvider.chatModels,
  MoonshotProvider.chatModels,
  OllamaProvider.chatModels,
  VLLMProvider.chatModels,
  XinferenceProvider.chatModels,
  OpenRouterProvider.chatModels,
  TogetherAIProvider.chatModels,
  FireworksAIProvider.chatModels,
  PerplexityProvider.chatModels,
  AnthropicProvider.chatModels,
  HuggingFaceProvider.chatModels,
  XAIProvider.chatModels,
  JinaProvider.chatModels,
  SambaNovaProvider.chatModels,
  CohereProvider.chatModels,
  V0Provider.chatModels,
  ZeroOneProvider.chatModels,
  StepfunProvider.chatModels,
  NovitaProvider.chatModels,
  NvidiaProvider.chatModels,
  BaichuanProvider.chatModels,
  TaichuProvider.chatModels,
  CloudflareProvider.chatModels,
  Ai360Provider.chatModels,
  AiHubMixProvider.chatModels,
  SiliconCloudProvider.chatModels,
  GiteeAIProvider.chatModels,
  UpstageProvider.chatModels,
  SparkProvider.chatModels,
  Ai21Provider.chatModels,
  HunyuanProvider.chatModels,
  WenxinProvider.chatModels,
  SenseNovaProvider.chatModels,
  InternLMProvider.chatModels,
  HigressProvider.chatModels,
  PPIOProvider.chatModels,
  Search1APIProvider.chatModels,
  InfiniAIProvider.chatModels,
  QiniuProvider.chatModels,
  VercelAIGatewayProvider.chatModels,
].flat();

export const DEFAULT_MODEL_PROVIDER_LIST = [
  ...(ENABLE_BUSINESS_FEATURES ? [LobeHubProvider] : []),
  AnthropicProvider,
  GoogleProvider,
  OpenAIProvider,
  DeepSeekProvider,
  XinferenceProvider,
  MoonshotProvider,
  BedrockProvider,
  VertexAIProvider,
  { ...AzureProvider, chatModels: [] },
  AzureAIProvider,
  AiHubMixProvider,
  OpenRouterProvider,
  FalProvider,
  OllamaProvider,
  OllamaCloudProvider,
  VLLMProvider,
  ComfyUIProvider,
  HuggingFaceProvider,
  CloudflareProvider,
  GithubProvider,
  GithubCopilotProvider,
  NewAPIProvider,
  BflProvider,
  NovitaProvider,
  PPIOProvider,
  Ai302Provider,
  NvidiaProvider,
  TogetherAIProvider,
  FireworksAIProvider,
  GroqProvider,
  PerplexityProvider,
  MistralProvider,
  ModelScopeProvider,
  Ai21Provider,
  UpstageProvider,
  XAIProvider,
  JinaProvider,
  SambaNovaProvider,
  CohereProvider,
  V0Provider,
  QwenProvider,
  WenxinProvider,
  TencentcloudProvider,
  HunyuanProvider,
  ZhiPuProvider,
  SiliconCloudProvider,
  ZeroOneProvider,
  SparkProvider,
  SenseNovaProvider,
  StepfunProvider,
  BaichuanProvider,
  VolcengineProvider,
  MinimaxProvider,
  LMStudioProvider,
  InternLMProvider,
  HigressProvider,
  GiteeAIProvider,
  TaichuProvider,
  Ai360Provider,
  Search1APIProvider,
  InfiniAIProvider,
  AkashChatProvider,
  QiniuProvider,
  ReplicateProvider,
  NebiusProvider,
  CometAPIProvider,
  VercelAIGatewayProvider,
  CerebrasProvider,
  ZenMuxProvider,
  XiaomiMiMoProvider,
];

export const filterEnabledModels = (provider: ModelProviderCard) => {
  return provider.chatModels.filter((v) => v.enabled).map((m) => m.id);
};

export const isProviderDisableBrowserRequest = (id: string) => {
  const provider = DEFAULT_MODEL_PROVIDER_LIST.find((v) => v.id === id && v.disableBrowserRequest);
  return !!provider;
};

export { default as Ai21ProviderCard } from './ai21';
export { default as Ai302ProviderCard } from './ai302';
export { default as Ai360ProviderCard } from './ai360';
export { default as AiHubMixProviderCard } from './aihubmix';
export { default as AkashChatProviderCard } from './akashchat';
export { default as AnthropicProviderCard } from './anthropic';
export { default as AzureProviderCard } from './azure';
export { default as AzureAIProviderCard } from './azureai';
export { default as BaichuanProviderCard } from './baichuan';
export { default as BedrockProviderCard } from './bedrock';
export { default as BflProviderCard } from './bfl';
export { default as CerebrasProviderCard } from './cerebras';
export { default as CloudflareProviderCard } from './cloudflare';
export { default as CohereProviderCard } from './cohere';
export { default as CometAPIProviderCard } from './cometapi';
export { default as ComfyUIProviderCard } from './comfyui';
export { default as DeepSeekProviderCard } from './deepseek';
export { default as FalProviderCard } from './fal';
export { default as FireworksAIProviderCard } from './fireworksai';
export { default as GiteeAIProviderCard } from './giteeai';
export { default as GithubProviderCard } from './github';
export { default as GithubCopilotProviderCard } from './githubCopilot';
export { default as GoogleProviderCard } from './google';
export { default as GroqProviderCard } from './groq';
export { default as HigressProviderCard } from './higress';
export { default as HuggingFaceProviderCard } from './huggingface';
export { default as HunyuanProviderCard } from './hunyuan';
export { default as InfiniAIProviderCard } from './infiniai';
export { default as InternLMProviderCard } from './internlm';
export { default as JinaProviderCard } from './jina';
export { default as LMStudioProviderCard } from './lmstudio';
export { default as LobeHubProviderCard } from './lobehub';
export { default as MinimaxProviderCard } from './minimax';
export { default as MistralProviderCard } from './mistral';
export { default as ModelScopeProviderCard } from './modelscope';
export { default as MoonshotProviderCard } from './moonshot';
export { default as NebiusProviderCard } from './nebius';
export { default as NewAPIProviderCard } from './newapi';
export { default as NovitaProviderCard } from './novita';
export { default as NvidiaProviderCard } from './nvidia';
export { default as OllamaProviderCard } from './ollama';
export { default as OllamaCloudProviderCard } from './ollamacloud';
export { default as OpenAIProviderCard } from './openai';
export { default as OpenRouterProviderCard } from './openrouter';
export { default as PerplexityProviderCard } from './perplexity';
export { default as PPIOProviderCard } from './ppio';
export { default as QiniuProviderCard } from './qiniu';
export { default as QwenProviderCard } from './qwen';
export { default as ReplicateProviderCard } from './replicate';
export { default as SambaNovaProviderCard } from './sambanova';
export { default as Search1APIProviderCard } from './search1api';
export { default as SenseNovaProviderCard } from './sensenova';
export { default as SiliconCloudProviderCard } from './siliconcloud';
export { default as SparkProviderCard } from './spark';
export { default as StepfunProviderCard } from './stepfun';
export { default as TaichuProviderCard } from './taichu';
export { default as TencentCloudProviderCard } from './tencentcloud';
export { default as TogetherAIProviderCard } from './togetherai';
export { default as UpstageProviderCard } from './upstage';
export { default as V0ProviderCard } from './v0';
export { default as VercelAIGatewayProviderCard } from './vercelaigateway';
export { default as VertexAIProviderCard } from './vertexai';
export { default as VLLMProviderCard } from './vllm';
export { default as VolcengineProviderCard } from './volcengine';
export { default as WenxinProviderCard } from './wenxin';
export { default as XAIProviderCard } from './xai';
export { default as XiaomiMiMoProviderCard } from './xiaomimimo';
export { default as XinferenceProviderCard } from './xinference';
export { default as ZenMuxProviderCard } from './zenmux';
export { default as ZeroOneProviderCard } from './zeroone';
export { default as ZhiPuProviderCard } from './zhipu';
