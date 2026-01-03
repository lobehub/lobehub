import { ActionIcon } from '@lobehub/ui';
import { LayoutPanelTop, LogsIcon, LucideBug, LucideBugOff, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../../store';
import Settings from './Settings';

interface ActionsProps {
  assistantMessageId: string;
  handleExpand?: (expand?: boolean) => void;
  identifier: string;
  setShowDebug?: (show: boolean) => void;
  setShowPluginRender: (show: boolean) => void;
  showCustomPluginRender: boolean;
  showDebug?: boolean;
  showPluginRender: boolean;
}

const Actions = memo<ActionsProps>(
  ({
    assistantMessageId,
    identifier,
    setShowDebug,
    setShowPluginRender,
    showCustomPluginRender,
    showDebug,
    showPluginRender,
    handleExpand,
  }) => {
    const { t } = useTranslation('plugin');
    const deleteAssistantMessage = useConversationStore((s) => s.deleteAssistantMessage);

    return (
      <>
        {showCustomPluginRender && (
          <ActionIcon
            icon={showPluginRender ? LogsIcon : LayoutPanelTop}
            onClick={() => {
              setShowPluginRender(!showPluginRender);
              handleExpand?.(true);
            }}
            size={'small'}
            title={showPluginRender ? t('inspector.args') : t('inspector.pluginRender')}
          />
        )}
        <ActionIcon
          active={showDebug}
          icon={showDebug ? LucideBugOff : LucideBug}
          onClick={() => {
            setShowDebug?.(!showDebug);
            handleExpand?.(true);
          }}
          size={'small'}
          title={t(showDebug ? 'debug.off' : 'debug.on')}
        />
        <Settings id={identifier} />
        <ActionIcon
          danger
          icon={Trash2}
          onClick={() => {
            deleteAssistantMessage(assistantMessageId);
          }}
          size={'small'}
          title={t('inspector.delete')}
        />
      </>
    );
  },
);

Actions.displayName = 'ToolActions';

export default Actions;
