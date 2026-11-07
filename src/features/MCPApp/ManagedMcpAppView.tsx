import { Button, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { mcpAppActions } from '@/store/mcpApp/action';

import McpAppView, { type McpAppViewProps } from './McpAppView';
import { useMcpAppPresentation } from './useMcpAppPresentation';

export interface ManagedMcpAppViewProps extends McpAppViewProps {
  icon?: string;
  location: 'inline' | 'fullscreen';
  preferred?: 'inline' | 'fullscreen';
  scope: string;
  title?: string;
}

/**
 * Both hosts share ownership; only the view's location mounts an iframe. The
 * location follows what the tool and its resource declare, then the app's own
 * requests: the host offers no switch between message and side panel.
 */
export const ManagedMcpAppView = ({
  location,
  preferred,
  scope,
  title,
  icon,
  ...props
}: ManagedMcpAppViewProps) => {
  const { enabled, view, panelAvailable, placed, mode, supported, presentation } =
    useMcpAppPresentation({
      ...props,
      agentId: props.host.agentId,
      location,
      preferred,
      scope,
      title,
      icon,
    });
  const { t } = useTranslation('plugin');
  if (!enabled || view?.dismissed) return props.fallback;
  // No frame until the declared location is known, so it never mounts in the wrong one
  if (!placed) return <Skeleton height={location === 'inline' ? 320 : '100%'} width={'100%'} />;
  if (mode !== location)
    return location === 'inline' ? (
      <Flexbox horizontal align={'center'} gap={8}>
        <Text type={'secondary'}>{t('mcpApp.panel.opened')}</Text>
        {panelAvailable && (
          <Button size={'small'} onClick={() => mcpAppActions.reveal(props.toolCallId)}>
            {t('mcpApp.panel.view')}
          </Button>
        )}
      </Flexbox>
    ) : null;
  return (
    <Flexbox
      gap={8}
      style={location === 'fullscreen' ? { height: '100%', minHeight: 0 } : undefined}
    >
      {supported ? <McpAppView {...props} presentation={presentation} /> : props.fallback}
    </Flexbox>
  );
};
