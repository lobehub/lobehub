import { DESKTOP_HEADER_ICON_SIZE } from '@lobechat/const';
import { EditorProvider, useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PanelRightCloseIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AutoSaveHint, EditorCanvas } from '@/features/EditorCanvas';
import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  content: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
    padding-inline: 16px;
  `,
  header: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  loading: css`
    padding: 12px;
  `,
}));

interface AgentDocumentEditorPanelProps {
  onClose: () => void;
  selectedDocumentId: string | null;
}

const Panel = memo<AgentDocumentEditorPanelProps>(({ selectedDocumentId, onClose }) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentStore((s) => s.activeAgentId);
  const editor = useEditor();

  const { data, error, isLoading } = useClientDataSWR(
    agentId && selectedDocumentId
      ? agentDocumentSWRKeys.readDocument(agentId, selectedDocumentId)
      : null,
    () => agentDocumentService.readDocument({ agentId: agentId!, id: selectedDocumentId! }),
  );

  if (!agentId || !selectedDocumentId) return null;

  const title = data?.filename || data?.title || t('workingPanel.documents.title');
  const documentId = data?.documentId;

  return (
    <Flexbox className={styles.container} data-testid="workspace-document-panel">
      <Flexbox
        horizontal
        align={'center'}
        className={styles.header}
        justify={'space-between'}
        padding={12}
      >
        <Text strong>{title}</Text>
        <Flexbox horizontal align={'center'} gap={8}>
          {documentId && <AutoSaveHint documentId={documentId} />}
          <ActionIcon
            icon={PanelRightCloseIcon}
            size={DESKTOP_HEADER_ICON_SIZE}
            onClick={onClose}
          />
        </Flexbox>
      </Flexbox>

      {isLoading && (
        <div className={styles.loading}>
          <Skeleton active paragraph={{ rows: 10 }} title={false} />
        </div>
      )}
      {error && (
        <Text style={{ padding: 12 }} type={'danger'}>
          {t('workingPanel.documents.error')}
        </Text>
      )}
      {!isLoading && !error && documentId && (
        <div className={styles.content}>
          <EditorCanvas documentId={documentId} editor={editor} sourceType="notebook" />
        </div>
      )}
    </Flexbox>
  );
});

const AgentDocumentEditorPanel = memo<AgentDocumentEditorPanelProps>((props) => {
  if (!props.selectedDocumentId) return null;
  return (
    <EditorProvider>
      <Panel {...props} />
    </EditorProvider>
  );
});

AgentDocumentEditorPanel.displayName = 'AgentDocumentEditorPanel';

export default AgentDocumentEditorPanel;
