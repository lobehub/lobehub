'use client';

import type { ReplaceTextArgs } from '@lobechat/editor-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ReplaceTextState } from '../../../types';

const styles = stylex.create({
  arrow: { marginInline: '4px', color: cssVar.colorTextQuaternary },
  from: { color: cssVar.colorTextSecondary, textDecoration: 'line-through' },
  title: { marginInlineEnd: '8px' },
  titleColor: { color: cssVar.colorText },
});

export const ReplaceTextInspector = memo<BuiltinInspectorProps<ReplaceTextArgs, ReplaceTextState>>(
  ({ args, partialArgs, isArgumentsStreaming, pluginState }) => {
    const { t } = useTranslation('plugin');

    const from = args?.searchText || partialArgs?.searchText;
    const to = args?.newText ?? partialArgs?.newText;

    // During streaming without searchText yet, show init message
    if (isArgumentsStreaming && !from) {
      return (
        <div className={inspectorTextStyles.root}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-page-agent.apiName.replaceText.init')}
          </span>
        </div>
      );
    }

    const count = pluginState?.replacementCount ?? 0;
    const hasResult = from && to !== undefined;

    return (
      <div className={inspectorTextStyles.root}>
        <span
          className={cx(
            stylex.props(styles.title, !isArgumentsStreaming && styles.titleColor).className,
            isArgumentsStreaming && shinyTextStyles.shinyText,
          )}
        >
          {t('builtins.lobe-page-agent.apiName.replaceText')}
        </span>
        {hasResult && (
          <>
            <span {...stylex.props(styles.from)}>{from}</span>
            <Icon className={stylex.props(styles.arrow).className} icon={ArrowRight} size={12} />
            <span className={highlightTextStyles.gold}>
              {to || t('builtins.lobe-page-agent.apiName.replaceText.empty')}
            </span>
            {count > 0 && (
              <Text code as={'span'} fontSize={12} type={'secondary'}>
                {' '}
                ({t('builtins.lobe-page-agent.apiName.replaceText.count', { count })})
              </Text>
            )}
          </>
        )}
      </div>
    );
  },
);

ReplaceTextInspector.displayName = 'ReplaceTextInspector';

export default ReplaceTextInspector;
