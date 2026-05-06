import { getLobeIconCDN } from '@lobehub/icons';

import { CLAUDE_CODE_API_BILLING_ENV } from '@/config/heterogeneousAgent';

export interface ClaudeCodeApiProviderPreset {
  env: Record<string, string>;
  iconId: string;
  id: string;
  label: string;
  required: string[][];
}

const anthropicIconId = 'Anthropic';

const CLAUDE_CODE_API_PROVIDER_PRESET_DEFINITIONS = [
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    },
    iconId: anthropicIconId,
    id: 'anthropic',
    label: 'Anthropic Compatible',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://router.shengsuanyun.com/api',
    },
    iconId: anthropicIconId,
    id: 'shengsuanyun',
    label: 'Shengsuanyun',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k2.6',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k2.6',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2.6',
      ANTHROPIC_MODEL: 'kimi-k2.6',
    },
    iconId: 'Moonshot',
    id: 'kimi',
    label: 'Kimi',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/',
    },
    iconId: 'Moonshot',
    id: 'kimi-coding',
    label: 'Kimi For Coding',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro',
      ANTHROPIC_MODEL: 'deepseek-v4-pro',
    },
    iconId: 'DeepSeek',
    id: 'deepseek',
    label: 'DeepSeek',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5',
      ANTHROPIC_MODEL: 'glm-5',
    },
    iconId: 'Zhipu',
    id: 'zhipu',
    label: 'Zhipu GLM',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
    },
    iconId: 'Bailian',
    id: 'bailian',
    label: 'Bailian',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    },
    iconId: 'Bailian',
    id: 'bailian-coding',
    label: 'Bailian For Coding',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.stepfun.com/step_plan',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'step-3.5-flash-2603',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'step-3.5-flash-2603',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'step-3.5-flash-2603',
      ANTHROPIC_MODEL: 'step-3.5-flash-2603',
    },
    iconId: 'Stepfun',
    id: 'stepfun',
    label: 'StepFun',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api-inference.modelscope.cn',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'ZhipuAI/GLM-5',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'ZhipuAI/GLM-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'ZhipuAI/GLM-5',
      ANTHROPIC_MODEL: 'ZhipuAI/GLM-5',
    },
    iconId: 'ModelScope',
    id: 'modelscope',
    label: 'ModelScope',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.longcat.chat/anthropic',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'LongCat-Flash-Chat',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'LongCat-Flash-Chat',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'LongCat-Flash-Chat',
      ANTHROPIC_MODEL: 'LongCat-Flash-Chat',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '6000',
    },
    iconId: 'LongCat',
    id: 'longcat',
    label: 'Longcat',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.7',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M2.7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-M2.7',
      ANTHROPIC_MODEL: 'MiniMax-M2.7',
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    iconId: 'Minimax',
    id: 'minimax',
    label: 'MiniMax',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://ark.cn-beijing.volces.com/api/coding',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'doubao-seed-2-0-code-preview-latest',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'doubao-seed-2-0-code-preview-latest',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'doubao-seed-2-0-code-preview-latest',
      ANTHROPIC_MODEL: 'doubao-seed-2-0-code-preview-latest',
      API_TIMEOUT_MS: '3000000',
    },
    iconId: 'Volcengine',
    id: 'doubao-seed',
    label: 'DouBaoSeed',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.tbox.cn/api/anthropic',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'Ling-2.5-1T',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'Ling-2.5-1T',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'Ling-2.5-1T',
      ANTHROPIC_MODEL: 'Ling-2.5-1T',
    },
    iconId: anthropicIconId,
    id: 'bailing',
    label: 'BaiLing',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://www.dmxapi.cn',
    },
    iconId: anthropicIconId,
    id: 'dmxapi',
    label: 'DMXAPI',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://www.packyapi.com',
    },
    iconId: anthropicIconId,
    id: 'packycode',
    label: 'PackyCode',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.cubence.com',
    },
    iconId: anthropicIconId,
    id: 'cubence',
    label: 'Cubence',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.aigocode.com',
    },
    iconId: anthropicIconId,
    id: 'aigocode',
    label: 'AIGoCode',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://www.right.codes/claude',
    },
    iconId: anthropicIconId,
    id: 'rightcode',
    label: 'RightCode',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.aicodemirror.com/api/claudecode',
    },
    iconId: anthropicIconId,
    id: 'aicodemirror',
    label: 'AICodeMirror',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.aicoding.sh',
    },
    iconId: anthropicIconId,
    id: 'aicoding',
    label: 'AICoding',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://crazyrouter.com',
    },
    iconId: anthropicIconId,
    id: 'crazyrouter',
    label: 'CrazyRouter',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://node-hk.sssaicode.com/api',
    },
    iconId: anthropicIconId,
    id: 'sssaicode',
    label: 'SSSAiCode',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.modelverse.cn',
    },
    iconId: anthropicIconId,
    id: 'compshare',
    label: 'Compshare',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://cp.compshare.cn',
    },
    iconId: anthropicIconId,
    id: 'compshare-coding-plan',
    label: 'Compshare Coding Plan',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://www.openclaudecode.cn',
    },
    iconId: anthropicIconId,
    id: 'micu',
    label: 'Micu',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.ctok.ai',
    },
    iconId: anthropicIconId,
    id: 'ctok',
    label: 'CTok.ai',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://www.ddshub.cc',
    },
    iconId: anthropicIconId,
    id: 'ddshub',
    label: 'DDSHub',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://e-flowcode.cc',
    },
    iconId: anthropicIconId,
    id: 'e-flowcode',
    label: 'E-FlowCode',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://vibecodingapi.ai',
    },
    iconId: anthropicIconId,
    id: 'lionccapi',
    label: 'LionCCAPI',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'anthropic/claude-haiku-4.5',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/claude-opus-4.7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'anthropic/claude-sonnet-4.6',
      ANTHROPIC_MODEL: 'anthropic/claude-sonnet-4.6',
    },
    iconId: 'OpenRouter',
    id: 'openrouter',
    label: 'OpenRouter',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.siliconflow.cn',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7',
      ANTHROPIC_MODEL: 'Pro/MiniMaxAI/MiniMax-M2.7',
    },
    iconId: 'SiliconCloud',
    id: 'siliconflow',
    label: 'SiliconFlow',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_BASE_URL: 'https://aihubmix.com',
    },
    iconId: 'AiHubMix',
    id: 'aihubmix',
    label: 'AiHubMix',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_API_KEY']],
  },
  {
    env: {
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_BASE_URL: 'https://api.lemondata.cc',
    },
    iconId: anthropicIconId,
    id: 'lemondata',
    label: 'LemonData',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_API_KEY']],
  },
  {
    env: {
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.therouter.ai',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'anthropic/claude-haiku-4.5',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/claude-opus-4.7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'anthropic/claude-sonnet-4.6',
      ANTHROPIC_MODEL: 'anthropic/claude-sonnet-4.6',
    },
    iconId: anthropicIconId,
    id: 'therouter',
    label: 'TheRouter',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.novita.ai/anthropic',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'zai-org/glm-5',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'zai-org/glm-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'zai-org/glm-5',
      ANTHROPIC_MODEL: 'zai-org/glm-5',
    },
    iconId: 'Novita',
    id: 'novita',
    label: 'Novita AI',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://cc-api.pipellm.ai',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_MODEL: 'claude-opus-4-7',
    },
    iconId: anthropicIconId,
    id: 'pipellm',
    label: 'PIPELLM',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://api.xiaomimimo.com/anthropic',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'mimo-v2-pro',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'mimo-v2-pro',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'mimo-v2-pro',
      ANTHROPIC_MODEL: 'mimo-v2-pro',
    },
    iconId: 'XiaomiMiMo',
    id: 'xiaomi-mimo',
    label: 'Xiaomi MiMo',
    required: [['ANTHROPIC_BASE_URL'], ['ANTHROPIC_AUTH_TOKEN']],
  },
  {
    env: {
      ANTHROPIC_BASE_URL: 'https://bedrock-runtime.${AWS_REGION}.amazonaws.com',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'global.anthropic.claude-opus-4-7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'global.anthropic.claude-sonnet-4-6',
      ANTHROPIC_MODEL: 'global.anthropic.claude-opus-4-7',
      AWS_ACCESS_KEY_ID: '',
      AWS_REGION: 'us-west-2',
      AWS_SECRET_ACCESS_KEY: '',
      CLAUDE_CODE_USE_BEDROCK: '1',
    },
    iconId: 'Bedrock',
    id: 'aws-bedrock-aksk',
    label: 'AWS Bedrock (AKSK)',
    required: [
      ['ANTHROPIC_BASE_URL'],
      ['AWS_REGION'],
      ['AWS_ACCESS_KEY_ID'],
      ['AWS_SECRET_ACCESS_KEY'],
    ],
  },
] as const satisfies ClaudeCodeApiProviderPreset[];

export const CLAUDE_CODE_API_PROVIDER_PRESETS = CLAUDE_CODE_API_PROVIDER_PRESET_DEFINITIONS.map(
  (preset) => ({
    ...preset,
    env: {
      ...CLAUDE_CODE_API_BILLING_ENV,
      ...preset.env,
    },
  }),
) satisfies ClaudeCodeApiProviderPreset[];

export const DEFAULT_CLAUDE_CODE_API_PROVIDER_PRESET = CLAUDE_CODE_API_PROVIDER_PRESETS[0];

export const getClaudeCodeApiProviderPreset = (id: string) =>
  CLAUDE_CODE_API_PROVIDER_PRESETS.find((preset) => preset.id === id);

export const inferClaudeCodeApiProviderPresetId = (env?: Record<string, string>) => {
  const baseUrl = env?.ANTHROPIC_BASE_URL;
  if (!baseUrl) return DEFAULT_CLAUDE_CODE_API_PROVIDER_PRESET.id;

  return (
    CLAUDE_CODE_API_PROVIDER_PRESETS.find((preset) => preset.env.ANTHROPIC_BASE_URL === baseUrl)
      ?.id ?? DEFAULT_CLAUDE_CODE_API_PROVIDER_PRESET.id
  );
};

export const formatRequiredEnvGroup = (group: string[]) => group.join(' or ');

export const getClaudeCodeApiProviderPresetAvatar = (preset: ClaudeCodeApiProviderPreset) =>
  getLobeIconCDN(preset.iconId, { cdn: 'aliyun', format: 'avatar' });
