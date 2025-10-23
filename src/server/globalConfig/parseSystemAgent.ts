import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@/const/settings';
import { UserSystemAgentConfig } from '@/types/user/settings';

const protectedKeys = Object.keys(DEFAULT_SYSTEM_AGENT_CONFIG);

const defaultTrueLey = new Set(['queryRewrite', 'autoSuggestion']);

export const parseSystemAgent = (envString: string = ''): Partial<UserSystemAgentConfig> => {
  if (!envString) return {};

  const config: Partial<UserSystemAgentConfig> = {};

  // 处理全角逗号和多余空格
  let envValue = envString.replaceAll('，', ',').trim();

  const pairs = envValue.split(',');

  // 用于存储默认设置，如果有 default=provider/model 的情况
  let defaultSetting: { model: string; provider: string } | undefined;

  for (const pair of pairs) {
    const [key, value] = pair.split('=').map((s) => s.trim());

    if (key && value) {
      const [provider, ...modelParts] = value.split('/');
      const model = modelParts.join('/');

      if (!provider || !model) {
        throw new Error('Missing model or provider value');
      }

      // 如果是 default 键，保存默认设置
      if (key === 'default') {
        defaultSetting = {
          model: model.trim(),
          provider: provider.trim(),
        };
        continue;
      }

      if (protectedKeys.includes(key)) {
        config[key as keyof UserSystemAgentConfig] = {
          enabled: defaultTrueLey.has(key) ? true : undefined,
          model: model.trim(),
          provider: provider.trim(),
        } as any;
      }
    } else {
      throw new Error('Invalid environment variable format');
    }
  }

  // 如果有默认设置，应用到所有未设置的系统智能体
  if (defaultSetting) {
    for (const key of protectedKeys) {
      if (!config[key as keyof UserSystemAgentConfig]) {
        config[key as keyof UserSystemAgentConfig] = {
          enabled: defaultTrueLey.has(key) ? true : undefined,
          model: defaultSetting.model,
          provider: defaultSetting.provider,
        } as any;
      }
    }
  }

  return config;
};
