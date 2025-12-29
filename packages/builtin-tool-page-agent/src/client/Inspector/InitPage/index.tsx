'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { InitDocumentArgs } from '@lobechat/editor-runtime';

import type { InitDocumentState } from '../../../types';
import { AnimatedNumber } from '../../components/AnimatedNumber';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chars: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextDescription};
  `,
  lines: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorSuccess};
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  `,
  title: css`
    margin-inline-end: 8px;
    color: ${cssVar.colorText};
  `,
}));

export const InitPageInspector = memo<BuiltinInspectorProps<InitDocumentArgs, InitDocumentState>>(
  ({ args, partialArgs, isArgumentsStreaming, pluginState }) => {
    const { t } = useTranslation('plugin');

    // Calculate lines and chars from markdown content
    const markdown = args?.markdown || partialArgs?.markdown || '';
    const lines = markdown ? markdown.split('\n').length : 0;
    const chars = markdown.length;

    // If we have state, use nodeCount as lines indicator
    const displayLines = pluginState?.nodeCount || lines;
    const hasContent = displayLines > 0 || chars > 0;

    // During streaming without content, show init
    if (isArgumentsStreaming) {
      if (!hasContent)
        return (
          <div className={cx(styles.root, shinyTextStyles.shinyText)}>
            <span>{t('builtins.lobe-page-agent.apiName.initPage')}</span>
          </div>
        );

      // During streaming with content, show "creating" title with shiny effect
      return (
        <div className={styles.root}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-page-agent.apiName.initPage.creating')}
          </span>
          {displayLines > 0 && (
            <span className={styles.lines}>
              {' '}
              <Icon icon={Plus} size={12} />
              <AnimatedNumber value={displayLines} />
              {t('builtins.lobe-page-agent.apiName.initPage.lines')}
            </span>
          )}
          {chars > 0 && (
            <span className={styles.chars}>
              {' '}
              <AnimatedNumber value={chars} />
              {t('builtins.lobe-page-agent.apiName.initPage.chars')}
            </span>
          )}
        </div>
      );
    }

    return (
      <div className={styles.root}>
        <span className={styles.title}>
          {t('builtins.lobe-page-agent.apiName.initPage.result')}
        </span>
        {displayLines > 0 && (
          <span className={styles.lines}>
            <Icon icon={Plus} size={12} />
            <AnimatedNumber value={displayLines} />
            {t('builtins.lobe-page-agent.apiName.initPage.lines')}
          </span>
        )}
        {chars > 0 && (
          <span className={styles.chars}>
            {' '}
            <AnimatedNumber value={chars} />
            {t('builtins.lobe-page-agent.apiName.initPage.chars')}
          </span>
        )}
      </div>
    );
  },
);

InitPageInspector.displayName = 'InitPageInspector';

export default InitPageInspector;
