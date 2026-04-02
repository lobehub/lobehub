import type { ToolManifest } from '@lobechat/types';
import { ToolManifestSchema } from '@lobechat/types';

import { API_ENDPOINTS } from '@/services/_url';

const fetchJSON = async <T = any>(url: string, proxy = false): Promise<T> => {
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

export const getToolManifest = async (
  url?: string,
  useProxy: boolean = false,
): Promise<ToolManifest> => {
  if (!url) {
    throw new TypeError('noManifest');
  }

  const data = await fetchJSON<ToolManifest>(url, useProxy);

  const parser = ToolManifestSchema.safeParse(data);

  if (!parser.success) {
    throw new TypeError('manifestInvalid', { cause: parser.error });
  }

  return data;
};
