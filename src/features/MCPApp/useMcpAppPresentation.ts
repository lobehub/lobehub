import { useEffect } from 'react';

import { mcpAppActions } from '@/store/mcpApp/action';
import { mcpAppContext } from '@/store/mcpApp/context';
import { mcpAppSelectors, useMcpAppStore } from '@/store/mcpApp/store';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';

import { resolveDisplayMode } from './displayMode';
import type { McpAppViewProps } from './McpAppView';
import { pickAppResource } from './utils';

export interface AppPresentationOptions {
  agentId?: string;
  icon?: string;
  identifier: string;
  location: 'inline' | 'fullscreen';
  messageId?: string;
  onThisDevice?: boolean;
  preferred?: 'inline' | 'fullscreen';
  resourceUri: string;
  scope: string;
  server?: string;
  title?: string;
  toolCallId: string;
}

/** Ownership and protocol callbacks shared by the inline and sidebar hosts. */
export const useMcpAppPresentation = ({
  agentId,
  icon,
  identifier,
  location,
  messageId,
  onThisDevice = false,
  preferred,
  resourceUri,
  scope,
  server,
  title,
  toolCallId,
}: AppPresentationOptions) => {
  const enabled = useServerConfigStore(serverConfigSelectors.enableMcpApps);
  const view = useMcpAppStore(mcpAppSelectors.view(toolCallId));
  const panelAvailable = useMcpAppStore(mcpAppSelectors.panelAvailable(scope));
  useEffect(() => {
    if (enabled)
      mcpAppActions.registerView(toolCallId, {
        identifier,
        messageId,
        scope,
        title: title || identifier,
        icon,
      });
  }, [enabled, toolCallId, identifier, messageId, scope, title, icon]);

  // Where the view lives follows what the tool and its resource declare,
  // decided before any frame mounts. Either host decides: a side panel tab
  // restored after a reload may have no message mounted. Same request as the
  // view's own.
  const useFetchMcpAppResource = useToolStore((s) => s.useFetchMcpAppResource);
  const deciding = enabled && !!view && !view.placed;
  const { data, isLoading } = useFetchMcpAppResource(identifier, resourceUri, {
    agentId,
    onThisDevice,
    server,
  });
  useEffect(() => {
    if (!deciding || isLoading) return;
    // After this commit's effects: the side panel registers itself in one
    const timer = setTimeout(() => {
      const hasPanel = mcpAppSelectors.panelAvailable(scope)(useMcpAppStore.getState());
      mcpAppActions.place(
        toolCallId,
        resolveDisplayMode({
          hostModes: hasPanel ? ['inline', 'fullscreen'] : ['inline'],
          resourceMeta: pickAppResource(data, resourceUri)?.meta,
          toolPreferred: preferred,
        }) === 'fullscreen'
          ? 'fullscreen'
          : 'inline',
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [data, deciding, isLoading, preferred, resourceUri, scope, toolCallId]);

  const mode = view?.mode ?? 'inline';
  const supported = !view?.availableModes || view.availableModes.includes(mode);
  const presentation: NonNullable<McpAppViewProps['presentation']> = {
    hostModes: panelAvailable ? ['inline', 'fullscreen'] : ['inline'],
    mode,
    onInitialized: (modes, resolved) =>
      mcpAppActions.settle(toolCallId, modes, resolved === 'fullscreen' ? 'fullscreen' : 'inline'),
    // Only the app moves itself; the host offers no switch of its own
    onMode: (requested) => {
      if (requested === 'pip') return mode;
      setTimeout(() => mcpAppActions.setMode(toolCallId, requested), 0);
      return requested;
    },
    onTeardown: () => mcpAppActions.dismiss(toolCallId),
    onUpdateModelContext: (params) => mcpAppContext.update(toolCallId, params),
    onDispose: () => mcpAppContext.clear(toolCallId),
    preferred,
    retireOnRemove: () => {
      const current = useMcpAppStore.getState().views[toolCallId];
      return (
        (current?.mode ?? 'inline') === location &&
        (!current?.availableModes || current.availableModes.includes(location))
      );
    },
  };
  return {
    enabled,
    mode,
    panelAvailable,
    placed: !!view?.placed,
    presentation,
    supported,
    view,
  };
};
