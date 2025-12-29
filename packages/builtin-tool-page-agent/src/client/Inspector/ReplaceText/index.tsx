'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ArrowRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { ReplaceTextArgs } from '@lobechat/editor-runtime';

import type { ReplaceTextState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  arrow: css`
    margin-inline: 4px;
    color: ${cssVar.colorTextQuaternary};
  `,
  from: css`
    color: ${cssVar.colorTextSecondary};
    text-decoration: line-through;
  `,
  highlight: css`
    padding-block-end: 1px;
    color: ${cssVar.colorText};
    background: linear-gradient(to top, ${cssVar.gold3} 40%, transparent 40%);
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
  stats: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    margin-inline-end: 8px;
    color: ${cssVar.colorText};
  `,
}));

export const ReplaceTextInspector = memo<BuiltinInspectorProps<ReplaceTextArgs, ReplaceTextState>>(
  ({ args, partialArgs, isArgumentsStreaming, pluginState }) => {
    const { t } = useTranslation('plugin');

    const from = args?.searchText || partialArgs?.searchText;
    const to = args?.newText ?? partialArgs?.newText;

    // During streaming without searchText yet, show init message
    if (isArgumentsStreaming && !from) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-page-agent.apiName.replaceText.init')}</span>
        </div>
      );
    }

    const count = pluginState?.replacementCount ?? 0;
    const hasResult = from && to !== undefined;

    return (
      <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
        <span className={styles.title}>{t('builtins.lobe-page-agent.apiName.replaceText')}</span>
        {hasResult && (
          <>
            <span className={styles.from}>{from}</span>
            <Icon className={styles.arrow} icon={ArrowRight} size={12} />
            <span className={styles.highlight}>
              {to || t('builtins.lobe-page-agent.apiName.replaceText.empty')}
            </span>
            {count > 0 && (
              <span className={styles.stats}>
                {' '}
                ({t('builtins.lobe-page-agent.apiName.replaceText.count', { count })})
              </span>
            )}
          </>
        )}
      </div>
    );
  },
);

ReplaceTextInspector.displayName = 'ReplaceTextInspector';

export default ReplaceTextInspector;
