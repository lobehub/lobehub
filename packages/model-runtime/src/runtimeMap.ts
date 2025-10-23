import { LobeAi21AI } from './providers/ai21';
import { Lobe302AI } from './providers/ai302';
import { LobeAi360AI } from './providers/ai360';
import { LobeAiHubMixAI } from './providers/aihubmix';
import { LobeAkashChatAI } from './providers/akashchat';
import { LobeAnthropicAI } from './providers/anthropic';
import { LobeAzureOpenAI } from './providers/azureOpenai';
import { LobeAzureAI } from './providers/azureai';
import { LobeBaichuanAI } from './providers/baichuan';
import { LobeBedrockAI } from './providers/bedrock';
import { LobeBflAI } from './providers/bfl';
import { LobeCerebrasAI } from './providers/cerebras';
import { LobeCloudflareAI } from './providers/cloudflare';
import { LobeCohereAI } from './providers/cohere';
import { LobeCometAPIAI } from './providers/cometapi';
import { LobeComfyUI } from './providers/comfyui';
import { LobeDeepSeekAI } from './providers/deepseek';
import { LobeFalAI } from './providers/fal';
import { LobeFireworksAI } from './providers/fireworksai';
import { LobeGiteeAI } from './providers/giteeai';
import { LobeGithubAI } from './providers/github';
import { LobeGoogleAI } from './providers/google';
import { LobeGroq } from './providers/groq';
import { LobeHigressAI } from './providers/higress';
import { LobeHuggingFaceAI } from './providers/huggingface';
import { LobeHunyuanAI } from './providers/hunyuan';
import { LobeInfiniAI } from './providers/infiniai';
import { LobeInternLMAI } from './providers/internlm';
import { LobeJinaAI } from './providers/jina';
import { LobeLMStudioAI } from './providers/lmstudio';
import { LobeMinimaxAI } from './providers/minimax';
import { LobeMistralAI } from './providers/mistral';
import { LobeModelScopeAI } from './providers/modelscope';
import { LobeMoonshotAI } from './providers/moonshot';
import { LobeNebiusAI } from './providers/nebius';
import { LobeNewAPIAI } from './providers/newapi';
import { LobeNovitaAI } from './providers/novita';
import { LobeNvidiaAI } from './providers/nvidia';
import { LobeOllamaAI } from './providers/ollama';
import { LobeOllamaCloudAI } from './providers/ollamacloud';
import { LobeOpenAI } from './providers/openai';
import { LobeOpenRouterAI } from './providers/openrouter';
import { LobePerplexityAI } from './providers/perplexity';
import { LobePPIOAI } from './providers/ppio';
import { LobeQiniuAI } from './providers/qiniu';
import { LobeQwenAI } from './providers/qwen';
import { LobeSambaNovaAI } from './providers/sambanova';
import { LobeSearch1API } from './providers/search1api';
import { LobeSenseNovaAI } from './providers/sensenova';
import { LobeSiliconCloudAI } from './providers/siliconcloud';
import { LobeSparkAI } from './providers/spark';
import { LobeStepfunAI } from './providers/stepfun';
import { LobeTaichuAI } from './providers/taichu';
import { LobeTencentCloudAI } from './providers/tencentcloud';
import { LobeTogetherAI } from './providers/togetherai';
import { LobeUpstageAI } from './providers/upstage';
import { LobeV0AI } from './providers/v0';
import { LobeVercelAIGatewayAI } from './providers/vercelaigateway';
import { LobeVLLMAI } from './providers/vllm';
import { LobeVolcengineAI } from './providers/volcengine';
import { LobeWenxinAI } from './providers/wenxin';
import { LobeXAI } from './providers/xai';
import { LobeXinferenceAI } from './providers/xinference';
import { LobeZeroOneAI } from './providers/zeroone';
import { LobeZhipuAI } from './providers/zhipu';

export const providerRuntimeMap = {
  ai21: LobeAi21AI,
  ai302: Lobe302AI,
  ai360: LobeAi360AI,
  aihubmix: LobeAiHubMixAI,
  akashchat: LobeAkashChatAI,
  anthropic: LobeAnthropicAI,
  azure: LobeAzureOpenAI,
  azureai: LobeAzureAI,
  baichuan: LobeBaichuanAI,
  bedrock: LobeBedrockAI,
  bfl: LobeBflAI,
  cerebras: LobeCerebrasAI,
  cloudflare: LobeCloudflareAI,
  cohere: LobeCohereAI,
  cometapi: LobeCometAPIAI,
  comfyui: LobeComfyUI,
  deepseek: LobeDeepSeekAI,
  fal: LobeFalAI,
  fireworksai: LobeFireworksAI,
  giteeai: LobeGiteeAI,
  github: LobeGithubAI,
  google: LobeGoogleAI,
  groq: LobeGroq,
  higress: LobeHigressAI,
  huggingface: LobeHuggingFaceAI,
  hunyuan: LobeHunyuanAI,
  infiniai: LobeInfiniAI,
  internlm: LobeInternLMAI,
  jina: LobeJinaAI,
  lmstudio: LobeLMStudioAI,
  minimax: LobeMinimaxAI,
  mistral: LobeMistralAI,
  modelscope: LobeModelScopeAI,
  moonshot: LobeMoonshotAI,
  nebius: LobeNebiusAI,
  newapi: LobeNewAPIAI,
  novita: LobeNovitaAI,
  nvidia: LobeNvidiaAI,
  ollama: LobeOllamaAI,
  ollamacloud: LobeOllamaCloudAI,
  openai: LobeOpenAI,
  openrouter: LobeOpenRouterAI,
  perplexity: LobePerplexityAI,
  ppio: LobePPIOAI,
  qiniu: LobeQiniuAI,
  qwen: LobeQwenAI,
  sambanova: LobeSambaNovaAI,
  search1api: LobeSearch1API,
  sensenova: LobeSenseNovaAI,
  siliconcloud: LobeSiliconCloudAI,
  spark: LobeSparkAI,
  stepfun: LobeStepfunAI,
  taichu: LobeTaichuAI,
  tencentcloud: LobeTencentCloudAI,
  togetherai: LobeTogetherAI,
  upstage: LobeUpstageAI,
  v0: LobeV0AI,
  vercelaigateway: LobeVercelAIGatewayAI,
  vllm: LobeVLLMAI,
  volcengine: LobeVolcengineAI,
  wenxin: LobeWenxinAI,
  xai: LobeXAI,
  xinference: LobeXinferenceAI,
  zeroone: LobeZeroOneAI,
  zhipu: LobeZhipuAI,
};
