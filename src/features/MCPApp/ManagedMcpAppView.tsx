import { Button, Flexbox, Text } from '@lobehub/ui';
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

/** Both hosts share ownership; only the selected location mounts an iframe. */
export const ManagedMcpAppView = ({
  location,
  preferred,
  scope,
  title,
  icon,
  ...props
}: ManagedMcpAppViewProps) => {
  const { enabled, view, panelAvailable, mode, supported, presentation } = useMcpAppPresentation({
    ...props,
    location,
    preferred,
    scope,
    title,
    icon,
  });
  const { t } = useTranslation('plugin');
  if (!enabled || view?.dismissed) return props.fallback;
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
      {supported ? <McpAppView {...props} presentation={presentation} /> : props.fallback}
    </Flexbox>
  );
};
