'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { InstallPluginParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  title: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
}));

export const InstallPluginInspector = memo<BuiltinInspectorProps<InstallPluginParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const identifier = args?.identifier || partialArgs?.identifier;

    if (isArgumentsStreaming && !identifier) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-agent-management.apiName.installPlugin')}</span>
        </div>
      );
    }

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
        gap={8}
      >
        <span className={styles.title}>
          {t('builtins.lobe-agent-management.inspector.installPlugin.title')}
        </span>
        {identifier && <span className={highlightTextStyles.primary}>{identifier}</span>}
      </Flexbox>
    );
  },
);

InstallPluginInspector.displayName = 'InstallPluginInspector';

export default InstallPluginInspector;
