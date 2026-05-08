'use client';

import { CopyButton, Flexbox, Markdown, ScrollShadow, TooltipGroup } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FileTextIcon } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
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
  title: string;
}

const DocumentCard = memo<DocumentCardProps>(({ content, title }) => (
  <Flexbox className={styles.container}>
    <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
      <FileTextIcon className={styles.icon} size={16} />
      <Flexbox flex={1}>
        <div className={styles.title}>{title}</div>
      </Flexbox>
      <TooltipGroup>
        <CopyButton content={content} size={'small'} />
      </TooltipGroup>
    </Flexbox>
    <ScrollShadow className={styles.content} offset={12} size={12} style={{ maxHeight: 400 }}>
      <Markdown style={{ overflow: 'unset', paddingBottom: 16 }} variant={'chat'}>
        {content}
      </Markdown>
    </ScrollShadow>
  </Flexbox>
));

export default DocumentCard;
