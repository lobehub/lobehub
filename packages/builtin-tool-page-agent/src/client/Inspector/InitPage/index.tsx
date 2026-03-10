'use client';

import type { InitDocumentArgs } from '@lobechat/editor-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { oneLineEllipsis, shinyTextStyles } from '@/styles';

import type { InitDocumentState } from '../../../types';
import { AnimatedNumber } from '../../components/AnimatedNumber';

const styles = createStaticStyles(({ css, cssVar }) => ({
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
          <div className={cx(oneLineEllipsis, shinyTextStyles.shinyText)}>
            <span>{t('builtins.lobe-page-agent.apiName.initPage')}</span>
          </div>
        );

      // During streaming with content, show "creating" title with shiny effect
      return (
        <div className={oneLineEllipsis}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-page-agent.apiName.initPage.creating')}
          </span>
          {displayLines > 0 && (
            <Text code as={'span'} color={cssVar.colorSuccess} fontSize={12}>
              {' '}
              <Icon icon={Plus} size={12} />
              <AnimatedNumber value={displayLines} />
              {t('builtins.lobe-page-agent.apiName.initPage.lines')}
            </Text>
          )}
          {chars > 0 && (
            <Text code as={'span'} color={cssVar.colorTextDescription} fontSize={12}>
              {' '}
              <AnimatedNumber value={chars} />
              {t('builtins.lobe-page-agent.apiName.initPage.chars')}
            </Text>
          )}
        </div>
      );
    }

    return (
      <div className={oneLineEllipsis}>
        <span className={styles.title}>
          {t('builtins.lobe-page-agent.apiName.initPage.result')}
        </span>
        {displayLines > 0 && (
          <Text code as={'span'} color={cssVar.colorSuccess} fontSize={12}>
            <Icon icon={Plus} size={12} />
            <AnimatedNumber value={displayLines} />
            {t('builtins.lobe-page-agent.apiName.initPage.lines')}
          </Text>
        )}
        {chars > 0 && (
          <Text code as={'span'} color={cssVar.colorTextDescription} fontSize={12}>
            {' '}
            <AnimatedNumber value={chars} />
            {t('builtins.lobe-page-agent.apiName.initPage.chars')}
          </Text>
        )}
      </div>
    );
  },
);

InitPageInspector.displayName = 'InitPageInspector';

export default InitPageInspector;
