'use client';

import { type WriteLocalFileParams } from '@lobechat/electron-client-ipc';
import { type BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import { FilePathDisplay } from '../../components/FilePathDisplay';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
}));

export const WriteLocalFileInspector = memo<BuiltinInspectorProps<WriteLocalFileParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const filePath = args?.path || partialArgs?.path || '';
    const content = args?.content || partialArgs?.content || '';

    // Calculate lines from content
    const lines = content ? content.split('\n').length : 0;

    // During argument streaming without path
    if (isArgumentsStreaming && !filePath) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-local-system.apiName.writeLocalFile')}</span>
        </div>
      );
    }

    return (
      <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-local-system.apiName.writeLocalFile')}: </span>
        <FilePathDisplay filePath={filePath} />
        {lines > 0 && (
          <Text as={'span'} code color={cssVar.colorSuccess} fontSize={12}>
            {' '}
            <Icon icon={Plus} size={12} />
            {lines}
          </Text>
        )}
      </div>
    );
  },
);

WriteLocalFileInspector.displayName = 'WriteLocalFileInspector';
