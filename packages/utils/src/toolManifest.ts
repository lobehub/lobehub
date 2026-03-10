import type { OpenAIPluginManifest } from '@lobechat/types';
import type { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { pluginManifestSchema } from '@lobehub/chat-plugin-sdk';

import { API_ENDPOINTS } from '@/services/_url';

const fetchJSON = async <T = any>(url: string, proxy = false): Promise<T> => {
  // 2. Send request
  let res: Response;
  try {
    res = await (proxy ? fetch(API_ENDPOINTS.proxy, { body: url, method: 'POST' }) : fetch(url));
  } catch {
    throw new TypeError('fetchError');
  }

  if (!res.ok) {
    throw new TypeError('fetchError');
  }

  let data;
  const contentType = res.headers.get('Content-Type');

  try {
    if (contentType === 'application/json') {
      data = await res.json();
    } else {
      const { default: YAML } = await import('yaml');

      const yaml = await res.text();
      data = YAML.parse(yaml);
    }
  } catch {
    throw new TypeError('urlError');
  }

  return data;
};

export const convertOpenAIManifestToLobeManifest = (
  data: OpenAIPluginManifest,
): LobeChatPluginManifest => {
  const manifest: LobeChatPluginManifest = {
    api: [],
    homepage: data.legal_info_url,
    identifier: data.name_for_model,
    meta: {
      avatar: data.logo_url,
      description: data.description_for_human,
      title: data.name_for_human,
    },
    openapi: data.api.url,
    systemRole: data.description_for_model,
    type: 'default',
    version: '1',
  };
  switch (data.auth.type) {
    case 'none': {
      break;
    }
    case 'service_http': {
      manifest.settings = {
        properties: {
          apiAuthKey: {
            default: data.auth.verification_tokens['openai'],
            description: 'API Key',
            format: 'password',
            title: 'API Key',
            type: 'string',
          },
        },
        type: 'object',
      };
      break;
    }
  }

  return manifest;
};

export const getToolManifest = async (
  url?: string,
  useProxy: boolean = false,
): Promise<LobeChatPluginManifest> => {
  // 1. Validate plugin
  if (!url) {
    throw new TypeError('noManifest');
  }

  // 2. Send request
  let data = await fetchJSON<LobeChatPluginManifest>(url, useProxy);

  // @ts-ignore
  // if there is a description_for_model, it is an OpenAI plugin
  // we need convert to lobe plugin
  if (data['description_for_model']) {
    data = convertOpenAIManifestToLobeManifest(data as any);
  }
  // 3. Validate plugin file format specification
  const parser = pluginManifestSchema.safeParse(data);

  if (!parser.success) {
    throw new TypeError('manifestInvalid', { cause: parser.error });
  }

  return data;
};
