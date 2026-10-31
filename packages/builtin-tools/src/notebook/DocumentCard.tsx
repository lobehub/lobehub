'use client';

import {
  ActionIcon,
  Button,
  CopyButton,
  Flexbox,
  Markdown,
  ScrollShadow,
  TooltipGroup,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Maximize2, Minimize2, NotebookText, PencilLine } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/slices/portal/selectors';

import type { NotebookDocument } from './types';

const styles = stylex.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    background: cssVar.colorBgContainer,
  },
  content: { paddingInline: '16px', fontSize: '14px' },
  expandButton: {
    position: 'absolute',
    insetBlockEnd: '16px',
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    boxShadow: cssVar.boxShadow,
  },
  header: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  icon: { color: cssVar.colorPrimary },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    fontWeight: 500,
    color: cssVar.colorText,
  },
});

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
    <Flexbox className={stylex.props(styles.container).className}>
      {/* Header */}
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={8}
      >
        <NotebookText className={stylex.props(styles.icon).className} size={16} />
        <Flexbox flex={1}>
          <div {...stylex.props(styles.title)}>{document.title}</div>
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
      <ScrollShadow
        className={stylex.props(styles.content).className}
        offset={12}
        size={12}
        style={{ maxHeight: 400 }}
      >
        <Markdown style={{ overflow: 'unset', paddingBottom: 40 }} variant={'chat'}>
          {document.content}
        </Markdown>
      </ScrollShadow>

      {/* Floating expand/collapse button */}
      <Button
        className={stylex.props(styles.expandButton).className}
        icon={isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        shape={'round'}
        type={'default'}
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
