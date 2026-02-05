'use client';

import { ActionIcon, CopyButton, Flexbox, Markdown, ScrollShadow, TooltipGroup } from '@lobehub/ui';
import { Button } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Maximize2, Minimize2, NotebookText, PencilLine } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/slices/portal/selectors';

import type { NotebookDocument } from '../../../types';

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
  document: NotebookDocument;
}

const DocumentCard = memo<DocumentCardProps>(({ document }) => {
  const { t } = useTranslation('plugin');
  const [portalDocumentId, openDocument, closeDocument] = useChatStore((s) => [
    chatPortalSelectors.portalDocumentId(s),
    s.openDocument,
    s.closeDocument,
  ]);

  const isExpanded = portalDocumentId === document.id;

  const handleToggle = () => {
    if (isExpanded) {
      closeDocument();
    } else {
      openDocument(document.id);
    }
  };

  return (
    <Flexbox className={styles.container}>
      {/* Header */}
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <NotebookText className={styles.icon} size={16} />
        <Flexbox flex={1}>
          <div className={styles.title}>{document.title}</div>
        </Flexbox>
        <TooltipGroup>
          <Flexbox horizontal gap={4}>
            <CopyButton
              content={document.content}
              size={'small'}
              title={t('builtins.lobe-notebook.actions.copy')}
            />
            <ActionIcon
              icon={PencilLine}
              size={'small'}
              title={t('builtins.lobe-notebook.actions.edit')}
              onClick={handleToggle}
            />
          </Flexbox>
        </TooltipGroup>
      </Flexbox>
      {/* Content */}
      <ScrollShadow className={styles.content} offset={12} size={12} style={{ maxHeight: 400 }}>
        <Markdown style={{ overflow: 'unset', paddingBottom: 40 }} variant={'chat'}>
          {document.content}
        </Markdown>
      </ScrollShadow>

      {/* Floating expand/collapse button */}
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
    </Flexbox>
  );
});

export default DocumentCard;
