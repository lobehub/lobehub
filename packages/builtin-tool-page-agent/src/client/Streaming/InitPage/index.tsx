'use client';

import type { InitDocumentArgs } from '@lobechat/editor-runtime';
import type { BuiltinStreamingProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileText, Hash, ListTree } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import StreamingMarkdown from '@/components/StreamingMarkdown';

import { AnimatedNumber } from '../../components/AnimatedNumber';

const MAX_PREVIEW_CHARS = 4000;

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '8px',
    background: cssVar.colorBgContainer,
  },
  header: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  icon: { color: cssVar.colorPrimary },
  meta: { color: cssVar.colorTextDescription },
  preview: { overflow: 'auto', maxHeight: '360px', paddingBlock: '8px', paddingInline: '12px' },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    fontWeight: 500,
    color: cssVar.colorText,
  },
});

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
    <Flexbox className={stylex.props(styles.container).className}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={8}
      >
        <FileText className={stylex.props(styles.icon).className} size={16} />
        <Flexbox flex={1} gap={2}>
          <div {...stylex.props(styles.title)}>
            {title || t('builtins.lobe-page-agent.apiName.initPage.creating')}
          </div>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.meta).className}
            gap={10}
          >
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
      <div {...stylex.props(styles.preview)}>
        <StreamingMarkdown>{preview}</StreamingMarkdown>
      </div>
    </Flexbox>
  );
});

InitPageStreaming.displayName = 'PageAgentInitPageStreaming';

export default InitPageStreaming;
