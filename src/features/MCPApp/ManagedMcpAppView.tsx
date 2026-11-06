import { Button, Flexbox, Text } from '@lobehub/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { mcpAppActions } from '@/store/mcpApp/action';
import { mcpAppContext } from '@/store/mcpApp/context';
import { mcpAppSelectors, useMcpAppStore } from '@/store/mcpApp/store';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import McpAppView, { type McpAppViewProps } from './McpAppView';

export interface ManagedMcpAppViewProps extends McpAppViewProps {
  location: 'inline' | 'fullscreen';
  preferred?: 'inline' | 'fullscreen';
  scope: string;
}

/** Both hosts share ownership; only the selected location mounts an iframe. */
export const ManagedMcpAppView = ({
  location,
  preferred,
  scope,
  ...props
}: ManagedMcpAppViewProps) => {
  const enabled = useServerConfigStore(serverConfigSelectors.enableMcpApps);
  const view = useMcpAppStore(mcpAppSelectors.view(props.toolCallId));
  const panelAvailable = useMcpAppStore(mcpAppSelectors.panelAvailable(scope));
  const { t } = useTranslation('plugin');
  useEffect(() => {
    if (!enabled) return;
    mcpAppActions.registerView(props.toolCallId, {
      identifier: props.identifier,
      messageId: props.messageId,
      scope,
      title: props.identifier,
    });
  }, [enabled, props.toolCallId, props.identifier, props.messageId, scope]);
  if (!enabled || view?.dismissed) return props.fallback;
  const mode = view?.mode ?? 'inline';
  if (mode !== location)
    return location === 'inline' ? (
      <Flexbox horizontal align={'center'} gap={8}>
        <Text type={'secondary'}>{t('mcpApp.panel.opened')}</Text>
        <Button
          size={'small'}
          onClick={() => mcpAppActions.setMode(props.toolCallId, 'fullscreen')}
        >
          {t('mcpApp.panel.view')}
        </Button>
        <Button size={'small'} onClick={() => mcpAppActions.setMode(props.toolCallId, 'inline')}>
          {t('mcpApp.panel.retract')}
        </Button>
      </Flexbox>
    ) : null;
  return (
    <Flexbox
      gap={8}
      style={location === 'fullscreen' ? { height: '100%', minHeight: 0 } : undefined}
    >
      {location === 'inline' && panelAvailable && view?.availableModes?.includes('fullscreen') && (
        <Flexbox horizontal justify={'flex-end'}>
          <Button
            size={'small'}
            onClick={() => mcpAppActions.setMode(props.toolCallId, 'fullscreen')}
          >
            {t('mcpApp.panel.open')}
          </Button>
        </Flexbox>
      )}
      <McpAppView
        {...props}
        presentation={{
          hostModes: panelAvailable ? ['inline', 'fullscreen'] : ['inline'],
          mode,
          onInitialized: (modes, resolved) => {
            mcpAppActions.setAvailableModes(props.toolCallId, modes);
            if (
              location === 'inline' &&
              mcpAppActions.consumeLive(props.toolCallId) &&
              resolved === 'fullscreen'
            ) {
              setTimeout(() => mcpAppActions.setMode(props.toolCallId, 'fullscreen'), 0);
            }
          },
          onMode: (requested) => {
            if (requested === 'pip') return mode;
            // Reply on the current bridge before moving ownership to another host.
            setTimeout(() => mcpAppActions.setMode(props.toolCallId, requested), 0);
            return requested;
          },
          onTeardown: () => mcpAppActions.close(props.toolCallId, true),
          onUpdateModelContext: (params) => mcpAppContext.update(props.toolCallId, params),
          onDispose: () => mcpAppContext.clear(props.toolCallId),
          preferred,
          retireOnRemove: () =>
            (useMcpAppStore.getState().views[props.toolCallId]?.mode ?? 'inline') === location,
        }}
      />
    </Flexbox>
  );
};
