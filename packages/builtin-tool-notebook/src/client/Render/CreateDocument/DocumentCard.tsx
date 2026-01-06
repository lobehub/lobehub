'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FileText, NotebookText } from 'lucide-react';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';

import { NotebookDocument } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    cursor: pointer;

    overflow: hidden;

    width: 100%;
    padding-block: 12px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgElevated};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  description: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
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
  typeTag: css`
    font-size: 11px;
  `,
}));

interface DocumentCardProps {
  document: NotebookDocument;
}

const DocumentCard = memo<DocumentCardProps>(({ document }) => {
  const openDocument = useChatStore((s) => s.openDocument);

  const handleClick = () => {
    openDocument(document.id);
  };

  return (
    <Flexbox className={styles.container} gap={8} onClick={handleClick}>
      <Flexbox align={'center'} gap={8} horizontal>
        {document.type === 'note' ? (
          <NotebookText className={styles.icon} size={16} />
        ) : (
          <FileText className={styles.icon} size={16} />
        )}
        <div className={styles.title}>{document.title}</div>
        <Tag className={styles.typeTag} size={'small'}>
          {document.type}
        </Tag>
      </Flexbox>
      {document.description && (
        <Text className={styles.description} ellipsis={{ rows: 2 }}>
          {document.description}
        </Text>
      )}
    </Flexbox>
  );
});

export default DocumentCard;
