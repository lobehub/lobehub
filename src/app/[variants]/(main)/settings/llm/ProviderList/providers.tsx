import { useMemo } from 'react';

import {
  Ai21ProviderCard,
  Ai302ProviderCard,
  Ai360ProviderCard,
  AkashChatProviderCard,
  AnthropicProviderCard,
  BaichuanProviderCard,
  CohereProviderCard,
  DeepSeekProviderCard,
  FeatherlessAIProviderCard,
  FireworksAIProviderCard,
  GiteeAIProviderCard,
  GoogleProviderCard,
  GroqProviderCard,
  HigressProviderCard,
  HunyuanProviderCard,
  InfiniAIProviderCard,
  InternLMProviderCard,
  JinaProviderCard,
  MinimaxProviderCard,
  MistralProviderCard,
  MoonshotProviderCard,
  NovitaProviderCard,
  NvidiaProviderCard,
  OllamaCloudProviderCard,
  OpenRouterProviderCard,
  PPIOProviderCard,
  PerplexityProviderCard,
  QiniuProviderCard,
  QwenProviderCard,
  SambaNovaProviderCard,
  Search1APIProviderCard,
  SenseNovaProviderCard,
  SiliconCloudProviderCard,
  SparkProviderCard,
  StepfunProviderCard,
  TaichuProviderCard,
  TogetherAIProviderCard,
  UpstageProviderCard,
  V0ProviderCard,
  VLLMProviderCard,
  WenxinProviderCard,
  XAIProviderCard,
  XinferenceProviderCard,
  ZeroOneProviderCard,
  ZhiPuProviderCard,
} from '@/config/modelProviders';

import { ProviderItem } from '../type';
import { useAzureProvider } from './Azure';
import { useBedrockProvider } from './Bedrock';
import { useCloudflareProvider } from './Cloudflare';
import { useGithubProvider } from './Github';
import { useHuggingFaceProvider } from './HuggingFace';
import { useOllamaProvider } from './Ollama';
import { useOpenAIProvider } from './OpenAI';

export const useProviderList = (): ProviderItem[] => {
  const AzureProvider = useAzureProvider();
  const OllamaProvider = useOllamaProvider();
  const OpenAIProvider = useOpenAIProvider();
  const BedrockProvider = useBedrockProvider();
  const CloudflareProvider = useCloudflareProvider();
  const GithubProvider = useGithubProvider();
  const HuggingFaceProvider = useHuggingFaceProvider();

  return useMemo(
    () => [
      OpenAIProvider,
      AzureProvider,
      OllamaProvider,
      VLLMProviderCard,
      XinferenceProviderCard,
      AnthropicProviderCard,
      BedrockProvider,
      GoogleProviderCard,
      DeepSeekProviderCard,
      HuggingFaceProvider,
      OpenRouterProviderCard,
      CloudflareProvider,
      GithubProvider,
      NovitaProviderCard,
      TogetherAIProviderCard,
      FeatherlessAIProviderCard,
      FireworksAIProviderCard,
      GroqProviderCard,
      NvidiaProviderCard,
      PerplexityProviderCard,
      MistralProviderCard,
      Ai21ProviderCard,
      UpstageProviderCard,
      XAIProviderCard,
      JinaProviderCard,
      SambaNovaProviderCard,
      Search1APIProviderCard,
      CohereProviderCard,
      V0ProviderCard,
      QiniuProviderCard,
      QwenProviderCard,
      WenxinProviderCard,
      HunyuanProviderCard,
      SparkProviderCard,
      ZhiPuProviderCard,
      ZeroOneProviderCard,
      SenseNovaProviderCard,
      StepfunProviderCard,
      MoonshotProviderCard,
      BaichuanProviderCard,
      MinimaxProviderCard,
      Ai360ProviderCard,
      TaichuProviderCard,
      InternLMProviderCard,
      SiliconCloudProviderCard,
      HigressProviderCard,
      GiteeAIProviderCard,
      PPIOProviderCard,
      InfiniAIProviderCard,
      AkashChatProviderCard,
      Ai302ProviderCard,
      OllamaCloudProviderCard,
    ],
    [
      AzureProvider,
      OllamaProvider,
      OpenAIProvider,
      BedrockProvider,
      CloudflareProvider,
      GithubProvider,
      HuggingFaceProvider,
    ],
  );
};
