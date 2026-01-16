import { ActionIcon } from '@lobehub/ui';
import { LayoutPanelTop, LogsIcon, LucideBug, LucideBugOff, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../../store';
import Settings from './Settings';

interface ActionsProps {
  assistantMessageId: string;
  canToggleCustomToolRender?: boolean;
  identifier: string;
  setShowCustomToolRender?: (show: boolean) => void;
  setShowDebug?: (show: boolean) => void;
  showCustomToolRender?: boolean;
  showDebug?: boolean;
}

const Actions = memo<ActionsProps>(
  ({
    assistantMessageId,
    canToggleCustomToolRender,
    identifier,
    setShowCustomToolRender,
    setShowDebug,
    showCustomToolRender,
    showDebug,
  }) => {
    const { t } = useTranslation('plugin');
    const deleteAssistantMessage = useConversationStore((s) => s.deleteAssistantMessage);

    return (
      <>
        {canToggleCustomToolRender && (
          <ActionIcon
            icon={showCustomToolRender ? LogsIcon : LayoutPanelTop}
            onClick={() => {
              setShowCustomToolRender?.(!showCustomToolRender);
            }}
            size={'small'}
            title={showCustomToolRender ? t('inspector.args') : t('inspector.pluginRender')}
          />
        )}
        <ActionIcon
          active={showDebug}
          icon={showDebug ? LucideBugOff : LucideBug}
          onClick={() => setShowDebug?.(!showDebug)}
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
