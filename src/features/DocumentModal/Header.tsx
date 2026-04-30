'use client';

import { ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { AutoSaveHint } from '@/features/EditorCanvas';
import { usePageAgentPanelControl } from '@/features/PageEditor/RightPanel/OverrideContext';
import { usePageEditorStore } from '@/features/PageEditor/store';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';

const HEADER_HEIGHT = 44;

interface DocumentModalHeaderProps {
  onClose: () => void;
}

const DocumentModalHeader = memo<DocumentModalHeaderProps>(({ onClose }) => {
  const { t } = useTranslation(['file', 'common']);

  const [documentId, emoji, title] = usePageEditorStore((s) => [s.documentId, s.emoji, s.title]);
  const { expand: showPageAgentPanel, toggle: togglePageAgentPanel } = usePageAgentPanelControl();

  return (
    <Flexbox
      horizontal
      align={'center'}
      flex={'none'}
      gap={4}
      height={HEADER_HEIGHT}
      justify={'space-between'}
      padding={8}
      style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}` }}
    >
      <Flexbox allowShrink horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
        {emoji && <Avatar avatar={emoji} shape={'square'} size={24} />}
        <Text ellipsis style={{ minWidth: 0 }} weight={500}>
          {title || t('pageEditor.titlePlaceholder')}
        </Text>
        {documentId && <AutoSaveHint documentId={documentId} style={{ marginLeft: 4 }} />}
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={4}>
        <ToggleRightPanelButton
          expand={showPageAgentPanel}
          showActive={false}
          onToggle={() => togglePageAgentPanel()}
        />
        <ActionIcon
          icon={XIcon}
          size={DESKTOP_HEADER_ICON_SIZE}
          title={t('close', { ns: 'common' })}
          onClick={onClose}
        />
      </Flexbox>
    </Flexbox>
  );
});

DocumentModalHeader.displayName = 'DocumentModalHeader';

export default DocumentModalHeader;
