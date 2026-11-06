import type { ContextSelection } from '@lobechat/types';
import type { McpUiUpdateModelContextRequest } from '@modelcontextprotocol/ext-apps/app-bridge';

import { getServerConfigStoreState, serverConfigSelectors } from '@/store/serverConfig';

import { useMcpAppStore } from './store';

const enabled = () => {
  const s = getServerConfigStoreState();
  return !!s && serverConfigSelectors.enableMcpApps(s);
};

/** A transaction consumes only the last update of each view; a failed send restores it. */
export const mcpAppContext = {
  clear(id: string) {
    useMcpAppStore.setState(
      (s) => ({
        contexts: Object.fromEntries(Object.entries(s.contexts).filter(([key]) => key !== id)),
      }),
      false,
      'mcpApp/clearContext',
    );
  },
  remove(id: string) {
    const current = useMcpAppStore.getState().contexts[id];
    if (current)
      useMcpAppStore.setState(
        (s) => ({ contexts: { ...s.contexts, [id]: { ...current, sent: current.content } } }),
        false,
        'mcpApp/removeContext',
      );
  },
  update(id: string, params: McpUiUpdateModelContextRequest['params']) {
    if (!enabled()) return;
    const view = useMcpAppStore.getState().views[id];
    if (!view || view.dismissed) return;
    const content = [
      ...(params.content ?? []).map((block) =>
        block.type === 'text' ? block.text : JSON.stringify(block),
      ),
      ...(params.structuredContent ? [JSON.stringify(params.structuredContent)] : []),
    ].join('\n');
    if (!content) {
      this.clear(id);
      return;
    }
    useMcpAppStore.setState(
      (s) => ({
        contexts: {
          ...s.contexts,
          [id]: {
            content,
            identifier: view.identifier,
            scope: view.scope,
            sent: s.contexts[id]?.sent,
            title: view.title,
          },
        },
      }),
      false,
      'mcpApp/updateContext',
    );
  },
  take(scope: string) {
    const entries = enabled()
      ? Object.entries(useMcpAppStore.getState().contexts).filter(
          ([, value]) => value.scope === scope && value.content !== value.sent,
        )
      : [];
    const selections: ContextSelection[] = entries.map(([id, value]) => ({
      content: value.content,
      id,
      identifier: value.identifier,
      source: 'mcpApp',
      title: value.title,
    }));
    for (const [id] of entries) this.remove(id);
    return {
      selections,
      restore: () => {
        if (!entries.length) return;
        const contexts = { ...useMcpAppStore.getState().contexts };
        for (const [id, value] of entries) {
          const current = contexts[id];
          if (current?.sent === value.content) contexts[id] = { ...current, sent: value.sent };
        }
        useMcpAppStore.setState({ contexts }, false, 'mcpApp/restoreContext');
      },
    };
  },
};
