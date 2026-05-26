import { type DynamicRouteMeta } from '@/spa/router/routeMeta';

import { type TabItem } from './types';
import { normalizeTabUrl } from './url';

export const TAB_PAGES_STORAGE_KEY_V1 = 'lobechat:desktop:tab-pages:v1';
export const TAB_PAGES_STORAGE_KEY = 'lobechat:desktop:tab-pages:v2';

interface TabPagesStorageData {
  activeTabId: string | null;
  tabs: TabItem[];
}

const EMPTY: TabPagesStorageData = { activeTabId: null, tabs: [] };

const isTabItem = (item: unknown): item is TabItem =>
  !!item &&
  typeof item === 'object' &&
  typeof (item as TabItem).id === 'string' &&
  typeof (item as TabItem).url === 'string' &&
  typeof (item as TabItem).lastVisited === 'number';

const reconstructUrlFromV1 = (type: unknown, params: unknown): string | null => {
  if (typeof type !== 'string' || !params || typeof params !== 'object') return null;
  const p = params as Record<string, string | undefined>;

  switch (type) {
    case 'home': {
      return '/';
    }
    case 'agent': {
      return p.agentId ? `/agent/${p.agentId}` : null;
    }
    case 'agent-topic': {
      return p.agentId && p.topicId ? `/agent/${p.agentId}/${p.topicId}` : null;
    }
    case 'group': {
      return p.groupId ? `/group/${p.groupId}` : null;
    }
    case 'group-topic': {
      return p.groupId && p.topicId ? `/group/${p.groupId}?topic=${p.topicId}` : null;
    }
    case 'page': {
      return p.pageId ? `/page/${p.pageId}` : null;
    }
    case 'settings': {
      return p.section ? `/settings/${p.section}` : '/settings';
    }
    case 'community': {
      return p.section ? `/community/${p.section}` : '/community';
    }
    case 'resource': {
      return p.section ? `/resource/${p.section}` : '/resource';
    }
    case 'memory': {
      return p.section ? `/memory/${p.section}` : '/memory';
    }
    case 'image': {
      return '/image';
    }
    default: {
      return null;
    }
  }
};

const migrateV1 = (): TabPagesStorageData => {
  if (typeof window === 'undefined') return EMPTY;

  try {
    const raw = window.localStorage.getItem(TAB_PAGES_STORAGE_KEY_V1);
    if (!raw) return EMPTY;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tabs)) return EMPTY;

    const seen = new Set<string>();
    const tabs: TabItem[] = [];
    let activeTabId: string | null = null;

    for (const old of parsed.tabs) {
      if (!old || typeof old !== 'object') continue;
      const url = reconstructUrlFromV1(old.type, old.params);
      if (!url) continue;

      const id = normalizeTabUrl(url);
      if (seen.has(id)) continue;
      seen.add(id);

      const cached =
        old.cached && typeof old.cached === 'object' ? (old.cached as DynamicRouteMeta) : undefined;

      tabs.push({
        cached,
        id,
        lastVisited: typeof old.lastVisited === 'number' ? old.lastVisited : Date.now(),
        url,
        visitCount: typeof old.visitCount === 'number' ? old.visitCount : undefined,
      });

      if (old.id === parsed.activeTabId) activeTabId = id;
    }

    return { activeTabId, tabs };
  } catch {
    return EMPTY;
  } finally {
    try {
      window.localStorage.removeItem(TAB_PAGES_STORAGE_KEY_V1);
    } catch {
      // ignore
    }
  }
};

export const getTabPages = (): TabPagesStorageData => {
  if (typeof window === 'undefined') return EMPTY;

  try {
    const data = window.localStorage.getItem(TAB_PAGES_STORAGE_KEY);
    if (!data) return migrateV1();

    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object') return EMPTY;

    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter(isTabItem) : [];

    return {
      activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null,
      tabs,
    };
  } catch {
    return EMPTY;
  }
};

export const saveTabPages = (tabs: TabItem[], activeTabId: string | null): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(TAB_PAGES_STORAGE_KEY, JSON.stringify({ activeTabId, tabs }));
    return true;
  } catch {
    return false;
  }
};
