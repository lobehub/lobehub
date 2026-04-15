import { DESKTOP_HEADER_ICON_SIZE } from '@lobechat/const';
import { ActionIcon, Button, Flexbox, Icon, Markdown, Skeleton, Text } from '@lobehub/ui';
import { Segmented } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Eye, PanelRightCloseIcon, SquarePen } from 'lucide-react';
import { extname } from 'pathe';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EditorTextArea from '@/features/EditorModal/TextArea';
import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  editor: css`
    flex: 1;
    min-height: 0;
    padding: 12px;
  `,
  editorWrapper: css`
    position: relative;
    flex: 1;
    min-height: 0;
  `,
  footer: css`
    overflow: hidden;
    transition:
      max-height 0.2s ${cssVar.motionEaseInOut},
      opacity 0.2s ${cssVar.motionEaseInOut},
      transform 0.2s ${cssVar.motionEaseInOut},
      border-color 0.2s ${cssVar.motionEaseInOut};
  `,
  footerOpen: css`
    transform: translateY(0);
    max-height: 72px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    opacity: 1;
  `,
  footerClosed: css`
    pointer-events: none;

    transform: translateY(8px);

    max-height: 0;
    border-block-start-color: transparent;

    opacity: 0;
  `,
  footerInner: css`
    padding: 12px;
  `,
  header: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  preview: css`
    overflow-y: auto;
    width: 100%;
    height: 100%;
    padding: 12px;
  `,
}));

interface AgentDocumentEditorPanelProps {
  onClose: () => void;
  selectedDocumentId: string | null;
}

type DocumentViewMode = 'edit' | 'preview';

const isMarkdownFile = (filename?: string) => {
  if (!filename) return false;

  const extension = extname(filename).toLowerCase();
  return extension === '.md' || extension === '.markdown';
};

const AgentDocumentEditorPanel = memo<AgentDocumentEditorPanelProps>(
  ({ selectedDocumentId, onClose }) => {
    const { t } = useTranslation('chat');
    const agentId = useAgentStore((s) => s.activeAgentId);
    const [draft, setDraft] = useState('');
    const [savedContent, setSavedContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [viewMode, setViewMode] = useState<DocumentViewMode>('edit');
    const initializedDocumentIdRef = useRef<string | null>(null);

    const { data, error, isLoading, mutate } = useClientDataSWR(
      agentId && selectedDocumentId
        ? agentDocumentSWRKeys.readDocument(agentId, selectedDocumentId)
        : null,
      () => agentDocumentService.readDocument({ agentId: agentId!, id: selectedDocumentId! }),
    );

    useEffect(() => {
      if (!data) return;
      if (data.id !== selectedDocumentId) return;
      if (initializedDocumentIdRef.current === data.id) return;

      setDraft(data.content);
      setSavedContent(data.content);
      setViewMode(isMarkdownFile(data.filename || data.title) ? 'preview' : 'edit');
      initializedDocumentIdRef.current = data.id;
    }, [data, selectedDocumentId]);

    useEffect(() => {
      if (selectedDocumentId) return;
      initializedDocumentIdRef.current = null;
    }, [selectedDocumentId]);

    const isDirty = useMemo(() => draft !== savedContent, [draft, savedContent]);
    const isDocumentReady = data?.id === selectedDocumentId;
    const shouldShowLoading = Boolean(selectedDocumentId) && (isLoading || !isDocumentReady);
    const isOpen = Boolean(selectedDocumentId);
    const isMarkdownDocument = isMarkdownFile(data?.filename || data?.title);

    if (!agentId) return null;

    const saveDocument = async () => {
      if (!isDirty || isSaving || !selectedDocumentId) return;

      setIsSaving(true);
      try {
        await agentDocumentService.editDocument({
          agentId,
          content: draft,
          id: selectedDocumentId,
        });
        await mutate();
        setSavedContent(draft);
      } finally {
        setIsSaving(false);
      }
    };

    if (!isOpen) return null;

    return (
      <Flexbox className={styles.container} data-testid="workspace-document-panel">
        <Flexbox
          horizontal
          align={'center'}
          className={styles.header}
          justify={'space-between'}
          padding={12}
        >
          <Text strong>{data?.filename || data?.title || t('workingPanel.documents.title')}</Text>
          <Flexbox horizontal align={'center'} gap={8}>
            {isMarkdownDocument && (
              <Segmented<DocumentViewMode>
                value={viewMode}
                options={[
                  {
                    label: (
                      <Flexbox horizontal align={'center'} gap={4}>
                        <Icon icon={Eye} size={14} />
                        <span style={{ fontSize: 12 }}>{t('workingPanel.documents.preview')}</span>
                      </Flexbox>
                    ),
                    value: 'preview',
                  },
                  {
                    label: (
                      <Flexbox horizontal align={'center'} gap={4}>
                        <Icon icon={SquarePen} size={14} />
                        <span style={{ fontSize: 12 }}>{t('workingPanel.documents.edit')}</span>
                      </Flexbox>
                    ),
                    value: 'edit',
                  },
                ]}
                onChange={(value) => setViewMode(value)}
              />
            )}
            <ActionIcon
              icon={PanelRightCloseIcon}
              size={DESKTOP_HEADER_ICON_SIZE}
              onClick={onClose}
            />
          </Flexbox>
        </Flexbox>

        {shouldShowLoading && (
          <Flexbox className={styles.editor} gap={8}>
            <Skeleton active paragraph={{ rows: 10 }} title={false} />
          </Flexbox>
        )}
        {error && (
          <Text style={{ padding: 12 }} type={'danger'}>
            {t('workingPanel.documents.error')}
          </Text>
        )}

        {!shouldShowLoading && !error && data && (
          <>
            <Flexbox className={styles.editorWrapper}>
              {viewMode === 'preview' ? (
                <div className={styles.preview}>
                  <Markdown variant={'chat'}>{draft}</Markdown>
                </div>
              ) : (
                <EditorTextArea
                  style={{ height: '100%', resize: 'none' }}
                  value={draft}
                  onChange={setDraft}
                />
              )}
            </Flexbox>
            <Flexbox
              className={`${styles.footer} ${isDirty ? styles.footerOpen : styles.footerClosed}`}
            >
              <Flexbox
                horizontal
                align={'center'}
                className={styles.footerInner}
                justify={'space-between'}
              >
                <Text type={'secondary'}>{t('workingPanel.documents.unsaved')}</Text>
                <Flexbox horizontal gap={8}>
                  <Button
                    disabled={isSaving || shouldShowLoading}
                    size={'small'}
                    onClick={() => setDraft(savedContent)}
                  >
                    {t('workingPanel.documents.discard')}
                  </Button>
                  <Button
                    disabled={shouldShowLoading || Boolean(error)}
                    loading={isSaving}
                    size={'small'}
                    type={'primary'}
                    onClick={saveDocument}
                  >
                    {t('workingPanel.documents.save')}
                  </Button>
                </Flexbox>
              </Flexbox>
            </Flexbox>
          </>
        )}
      </Flexbox>
    );
  },
);

AgentDocumentEditorPanel.displayName = 'AgentDocumentEditorPanel';

export default AgentDocumentEditorPanel;
