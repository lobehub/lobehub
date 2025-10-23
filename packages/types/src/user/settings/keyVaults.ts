export interface OpenAICompatibleKeyVault {
  apiKey?: string;
  baseURL?: string;
}

export interface FalKeyVault {
  apiKey?: string;
}

export interface AzureOpenAIKeyVault {
  apiKey?: string;
  apiVersion?: string;
  baseURL?: string;
  /**
   * @deprecated
   */
  endpoint?: string;
}

export interface AWSBedrockKeyVault {
  accessKeyId?: string;
  region?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export interface VertexAIKeyVault {
  apiKey?: string;
  region?: string;
}

export interface CloudflareKeyVault {
  apiKey?: string;
  baseURLOrAccountID?: string;
}

export interface ComfyUIKeyVault {
  apiKey?: string;
  authType?: 'none' | 'basic' | 'bearer' | 'custom';
  baseURL?: string;
  customHeaders?: Record<string, string>;
  password?: string;
  username?: string;
}

export interface SearchEngineKeyVaults {
  searchxng?: {
    apiKey?: string;
    baseURL?: string;
  };
}

export interface UserKeyVaults extends SearchEngineKeyVaults {
  ai21?: OpenAICompatibleKeyVault;
  ai302?: OpenAICompatibleKeyVault;
  ai360?: OpenAICompatibleKeyVault;
  aihubmix?: OpenAICompatibleKeyVault;
  akashchat?: OpenAICompatibleKeyVault;
  anthropic?: OpenAICompatibleKeyVault;
  azure?: AzureOpenAIKeyVault;
  azureai?: AzureOpenAIKeyVault;
  baichuan?: OpenAICompatibleKeyVault;
  bedrock?: AWSBedrockKeyVault;
  bfl?: any;
  cerebras?: OpenAICompatibleKeyVault;
  cloudflare?: CloudflareKeyVault;
  cohere?: OpenAICompatibleKeyVault;
  cometapi?: OpenAICompatibleKeyVault;
  comfyui?: ComfyUIKeyVault;
  deepseek?: OpenAICompatibleKeyVault;
  fal?: FalKeyVault;
  fireworksai?: OpenAICompatibleKeyVault;
  giteeai?: OpenAICompatibleKeyVault;
  github?: OpenAICompatibleKeyVault;
  google?: OpenAICompatibleKeyVault;
  groq?: OpenAICompatibleKeyVault;
  higress?: OpenAICompatibleKeyVault;
  huggingface?: OpenAICompatibleKeyVault;
  hunyuan?: OpenAICompatibleKeyVault;
  infiniai?: OpenAICompatibleKeyVault;
  internlm?: OpenAICompatibleKeyVault;
  jina?: OpenAICompatibleKeyVault;
  lmstudio?: OpenAICompatibleKeyVault;
  lobehub?: any;
  minimax?: OpenAICompatibleKeyVault;
  mistral?: OpenAICompatibleKeyVault;
  modelscope?: OpenAICompatibleKeyVault;
  moonshot?: OpenAICompatibleKeyVault;
  nebius?: OpenAICompatibleKeyVault;
  newapi?: OpenAICompatibleKeyVault;
  novita?: OpenAICompatibleKeyVault;
  nvidia?: OpenAICompatibleKeyVault;
  ollama?: OpenAICompatibleKeyVault;
  ollamacloud?: OpenAICompatibleKeyVault;
  openai?: OpenAICompatibleKeyVault;
  openrouter?: OpenAICompatibleKeyVault;
  password?: string;
  perplexity?: OpenAICompatibleKeyVault;
  ppio?: OpenAICompatibleKeyVault;
  qiniu?: OpenAICompatibleKeyVault;
  qwen?: OpenAICompatibleKeyVault;
  sambanova?: OpenAICompatibleKeyVault;
  search1api?: OpenAICompatibleKeyVault;
  sensenova?: OpenAICompatibleKeyVault;
  siliconcloud?: OpenAICompatibleKeyVault;
  spark?: OpenAICompatibleKeyVault;
  stepfun?: OpenAICompatibleKeyVault;
  taichu?: OpenAICompatibleKeyVault;
  tencentcloud?: OpenAICompatibleKeyVault;
  togetherai?: OpenAICompatibleKeyVault;
  upstage?: OpenAICompatibleKeyVault;
  v0?: OpenAICompatibleKeyVault;
  vercelaigateway?: OpenAICompatibleKeyVault;
  vertexai?: VertexAIKeyVault;
  vllm?: OpenAICompatibleKeyVault;
  volcengine?: OpenAICompatibleKeyVault;
  wenxin?: OpenAICompatibleKeyVault;
  xai?: OpenAICompatibleKeyVault;
  xinference?: OpenAICompatibleKeyVault;
  zeroone?: OpenAICompatibleKeyVault;
  zhipu?: OpenAICompatibleKeyVault;
}
