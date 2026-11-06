import { useEffect } from 'react';

import { mcpAppActions } from '@/store/mcpApp/action';
import { mcpAppContext } from '@/store/mcpApp/context';
import { mcpAppSelectors, useMcpAppStore } from '@/store/mcpApp/store';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import type { McpAppViewProps } from './McpAppView';

export interface AppPresentationOptions {
  icon?: string;
  identifier: string;
  location: 'inline' | 'fullscreen';
  messageId?: string;
  preferred?: 'inline' | 'fullscreen';
  scope: string;
  title?: string;
  toolCallId: string;
}

/** Ownership and protocol callbacks shared by the inline and sidebar hosts. */
export const useMcpAppPresentation = ({
  icon,
  identifier,
  location,
  messageId,
  preferred,
  scope,
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
  const mode = view?.mode ?? 'inline';
  const supported = !view?.availableModes || view.availableModes.includes(mode);
  const presentation: NonNullable<McpAppViewProps['presentation']> = {
    hostModes: panelAvailable ? ['inline', 'fullscreen'] : ['inline'],
    mode,
    onInitialized: (modes, resolved) => {
      mcpAppActions.setAvailableModes(toolCallId, modes);
      if (
        location === 'inline' &&
        mcpAppActions.consumeLive(toolCallId) &&
        resolved === 'fullscreen'
      )
        setTimeout(() => mcpAppActions.setMode(toolCallId, 'fullscreen'), 0);
    },
    onMode: (requested) => {
      if (requested === 'pip') return mode;
      setTimeout(() => mcpAppActions.setMode(toolCallId, requested), 0);
      return requested;
    },
    onTeardown: () => mcpAppActions.close(toolCallId, true),
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
  return { enabled, view, panelAvailable, mode, supported, presentation };
};
