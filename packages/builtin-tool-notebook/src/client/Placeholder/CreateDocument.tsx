'use client';

import type { BuiltinPlaceholderProps } from '@lobechat/types';
import { Flexbox, Markdown, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { NotebookText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import type { CreateDocumentArgs } from '../../types';

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
    padding-block: 16px;
    padding-inline: 16px;
  `,
  header: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  icon: css`
    color: ${cssVar.colorPrimary};
  `,
  statusTag: css`
    position: absolute;
    inset-block-end: 16px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    display: inline-flex;
    gap: 8px;
    align-items: center;

    height: 32px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    font-size: 14px;
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
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

export const CreateDocumentPlaceholder = memo<BuiltinPlaceholderProps<CreateDocumentArgs>>(
  ({ args }) => {
    const { t } = useTranslation('plugin');
    const { title, content } = args || {};

    return (
      <Flexbox className={styles.container}>
        {/* Header */}
        <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
          <NotebookText className={styles.icon} size={16} />
          <Flexbox flex={1}>
            <div className={styles.title}>{title}</div>
          </Flexbox>
          <NeuralNetworkLoading size={20} />
        </Flexbox>
        {/* Content skeleton */}
        <ScrollShadow className={styles.content} offset={12} size={12} style={{ maxHeight: 400 }}>
          {content && (
            <Markdown style={{ overflow: 'unset', paddingBottom: 40 }} variant={'chat'}>
              {content}
            </Markdown>
          )}
        </ScrollShadow>
        <div className={styles.statusTag}>
          <NeuralNetworkLoading size={16} />
          <span>{t('builtins.lobe-notebook.actions.creating')}</span>
        </div>
      </Flexbox>
    );
  },
);

export default CreateDocumentPlaceholder;
