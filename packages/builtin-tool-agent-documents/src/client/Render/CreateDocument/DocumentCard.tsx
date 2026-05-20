'use client';

import { ActionIcon, CopyButton, Flexbox, Markdown, ScrollShadow, TooltipGroup } from '@lobehub/ui';
import { Button } from 'antd';
import { createStaticStyles } from 'antd-style';
import { FileTextIcon, Maximize2, Minimize2, PencilLine } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/slices/portal/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
  content: css`
    padding-inline: 16px;
    font-size: 14px;
  `,
  expandButton: css`
    position: absolute;
    inset-block-end: 16px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    box-shadow: ${cssVar.boxShadow};
  `,
  header: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  icon: css`
    color: ${cssVar.colorPrimary};
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface DocumentCardProps {
  content: string;
  documentId?: string;
  title: string;
}

const DocumentCard = memo<DocumentCardProps>(({ content, documentId, title }) => {
  const { t } = useTranslation('plugin');
  const [portalDocumentId, openDocument, closeDocument] = useChatStore((s) => [
    chatPortalSelectors.portalDocumentId(s),
    s.openDocument,
    s.closeDocument,
  ]);

  const isExpanded = !!documentId && portalDocumentId === documentId;

  const handleToggle = () => {
    if (!documentId) return;
    if (isExpanded) {
      closeDocument();
    } else {
      openDocument(documentId);
    }
  };

  return (
    <Flexbox className={styles.container}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <FileTextIcon className={styles.icon} size={16} />
        <Flexbox flex={1}>
          <div className={styles.title}>{title}</div>
        </Flexbox>
        <TooltipGroup>
          <Flexbox horizontal gap={4}>
            <CopyButton
              content={content}
              size={'small'}
              title={t('builtins.lobe-notebook.actions.copy')}
            />
            {documentId && (
              <ActionIcon
                icon={PencilLine}
                size={'small'}
                title={t('builtins.lobe-notebook.actions.edit')}
                onClick={handleToggle}
              />
            )}
          </Flexbox>
        </TooltipGroup>
      </Flexbox>
      <ScrollShadow className={styles.content} offset={12} size={12} style={{ maxHeight: 400 }}>
        <Markdown style={{ overflow: 'unset', paddingBottom: 40 }} variant={'chat'}>
          {content}
        </Markdown>
      </ScrollShadow>

      {documentId && (
        <Button
          className={styles.expandButton}
          color={'default'}
          icon={isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          shape={'round'}
          variant={'outlined'}
          onClick={handleToggle}
        >
          {isExpanded
            ? t('builtins.lobe-notebook.actions.collapse')
            : t('builtins.lobe-notebook.actions.expand')}
        </Button>
      )}
    </Flexbox>
  );
});

export default DocumentCard;
