'use client';

import type { InitDocumentArgs } from '@lobechat/editor-runtime';
import type { BuiltinStreamingProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FileText, Hash, ListTree } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import StreamingMarkdown from '@/components/StreamingMarkdown';

import { AnimatedNumber } from '../../components/AnimatedNumber';

const MAX_PREVIEW_CHARS = 4000;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
  `,
  header: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  icon: css`
    color: ${cssVar.colorPrimary};
  `,
  meta: css`
    color: ${cssVar.colorTextDescription};
  `,
  preview: css`
    max-height: 360px;
    overflow: auto;
    padding-block: 8px;
    padding-inline: 12px;
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

const extractTitle = (markdown: string) => {
  const titleLine = markdown
    .split(/\r?\n/)
    .find((line) => line.startsWith('# ') && line.slice(2).trim().length > 0);

  return titleLine?.slice(2).trim();
};

export const InitPageStreaming = memo<BuiltinStreamingProps<InitDocumentArgs>>(({ args }) => {
  const { t } = useTranslation('plugin');
  const markdown = args?.markdown || '';

  const { chars, lines, preview, title } = useMemo(() => {
    const preview =
      markdown.length > MAX_PREVIEW_CHARS
        ? `${markdown.slice(0, MAX_PREVIEW_CHARS)}\n\n...`
        : markdown;

    return {
      chars: markdown.length,
      lines: markdown ? markdown.split('\n').length : 0,
      preview,
      title: extractTitle(markdown),
    };
  }, [markdown]);

  if (!markdown) return null;

  return (
    <Flexbox className={styles.container}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <FileText className={styles.icon} size={16} />
        <Flexbox flex={1} gap={2}>
          <div className={styles.title}>
            {title || t('builtins.lobe-page-agent.apiName.initPage.creating')}
          </div>
          <Flexbox horizontal align={'center'} className={styles.meta} gap={10}>
            <Text as={'span'} color={cssVar.colorTextDescription} fontSize={12}>
              <Icon icon={ListTree} size={12} /> <AnimatedNumber value={lines} />
              {t('builtins.lobe-page-agent.apiName.initPage.lines')}
            </Text>
            <Text as={'span'} color={cssVar.colorTextDescription} fontSize={12}>
              <Icon icon={Hash} size={12} /> <AnimatedNumber value={chars} />
              {t('builtins.lobe-page-agent.apiName.initPage.chars')}
            </Text>
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <div className={styles.preview}>
        <StreamingMarkdown>{preview}</StreamingMarkdown>
      </div>
    </Flexbox>
  );
});

InitPageStreaming.displayName = 'PageAgentInitPageStreaming';

export default InitPageStreaming;
