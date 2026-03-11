import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@/const/settings';
import { type UserSystemAgentConfig } from '@/types/user/settings';

const protectedKeys = Object.keys(DEFAULT_SYSTEM_AGENT_CONFIG);

const defaultTrueLey = new Set(['queryRewrite', 'autoSuggestion']);

export const parseSystemAgent = (envString: string = ''): Partial<UserSystemAgentConfig> => {
  if (!envString) return {};

  const config: Partial<UserSystemAgentConfig> = {};

  // Handle full-width commas and extra spaces
  const envValue = envString.replaceAll('，', ',').trim();

  const pairs = envValue.split(',');

  // Store default settings if there is a default=provider/model case
  let defaultSetting: { model: string; provider: string } | undefined;

  for (const pair of pairs) {
    const [key, value] = pair.split('=').map((s) => s.trim());

    if (key && value) {
      const [provider, ...modelParts] = value.split('/');
      const model = modelParts.join('/');

      if (!provider || !model) {
        throw new Error('Missing model or provider value');
      }

      // If it's the default key, save the default settings
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

  // If there are default settings, apply them to all unconfigured system agents
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
