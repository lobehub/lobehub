import { EdgeConfig } from '@lobechat/edge-config';
import urlJoin from 'url-join';

import { DEFAULT_LANG, isLocaleNotSupport } from '@/const/locale';
import { appEnv } from '@/envs/app';
import { type Locales } from '@/locales/resources';
import { normalizeLocale } from '@/locales/resources';
import { CacheRevalidate, CacheTag } from '@/types/discover';

export class AssistantStore {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || appEnv.AGENTS_INDEX_URL;
  }

  private getAgentIndexUrl = (lang: Locales = DEFAULT_LANG) => {
    if (isLocaleNotSupport(lang)) return this.baseUrl;

    return urlJoin(this.baseUrl, `index.${normalizeLocale(lang)}.json`);
  };

  getAgentUrl = (identifier: string, lang: Locales = DEFAULT_LANG) => {
    if (isLocaleNotSupport(lang)) return urlJoin(this.baseUrl, `${identifier}.json`);

    return urlJoin(this.baseUrl, `${identifier}.${normalizeLocale(lang)}.json`);
  };

  getAgentIndex = async (locale: Locales = DEFAULT_LANG): Promise<any[]> => {
    let res: Response;
    try {
      res = await fetch(this.getAgentIndexUrl(locale as any), {
        cache: 'force-cache',
        next: { revalidate: CacheRevalidate.List, tags: [CacheTag.Discover, CacheTag.Assistants] },
      });

      if (res.status === 404) {
        res = await fetch(this.getAgentIndexUrl(DEFAULT_LANG), {
          cache: 'force-cache',
          next: {
            revalidate: CacheRevalidate.List,
            tags: [CacheTag.Discover, CacheTag.Assistants],
          },
        });
      }

      if (!res.ok) {
        console.warn('fetch agent index error:', await res.text());
        return [];
      }

      const data: any = await res.clone().json();

      if (EdgeConfig.isEnabled()) {
        // Get the assistant whitelist from Edge Config
        const edgeConfig = new EdgeConfig();

        const { whitelist, blacklist } = await edgeConfig.getAgentRestrictions();

        // use whitelist mode first
        if (whitelist && whitelist?.length > 0) {
          data.agents = data.agents.filter((item: any) => whitelist.includes(item.identifier));
        }

        // if no whitelist, use blacklist mode
        else if (blacklist && blacklist?.length > 0) {
          data.agents = data.agents.filter((item: any) => !blacklist.includes(item.identifier));
        }
      }

      return data.agents;
    } catch (e) {
      // it means failed to fetch
      if ((e as Error).message.includes('fetch failed')) {
        return [];
      }

      console.error(`[AgentIndexFetchError] failed to fetch agent index, error detail:`);
      console.error(e);
      if (res!) {
        console.error(`status code: ${res?.status}`, await res.text());
      }

      throw e;
    }
  };

  getAgent = async (identifier: string, lang: Locales = DEFAULT_LANG): Promise<any> => {
    let res = await fetch(this.getAgentUrl(identifier, lang), {
      cache: 'force-cache',
      next: {
        revalidate: CacheRevalidate.Details,
        tags: [CacheTag.Discover, CacheTag.Assistants],
      },
    });
    if (!res.ok) {
      res = await fetch(this.getAgentUrl(identifier, DEFAULT_LANG), {
        cache: 'force-cache',
        next: {
          revalidate: CacheRevalidate.Details,
          tags: [CacheTag.Discover, CacheTag.Assistants],
        },
      });
    }
    if (!res.ok) return;
    const data = await res.json();
    return data;
  };
}
