'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { WriteLocalFileState } from '../../../types';
import { FilePathDisplay } from '../../components/FilePathDisplay';

interface WriteLocalFileParams {
  content: string;
  path: string;
}

export const WriteLocalFileInspector = memo<
  BuiltinInspectorProps<WriteLocalFileParams, WriteLocalFileState>
>(({ args, partialArgs, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  const filePath = args?.path || partialArgs?.path || '';
  const content = args?.content || partialArgs?.content || '';

  // Calculate lines from content
  const lines = content ? content.split('\n').length : 0;

  // During argument streaming without path
  if (isArgumentsStreaming && !filePath) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-cloud-sandbox.apiName.writeLocalFile')}</span>
      </div>
    );
  }

  return (
    <div
      className={cx(inspectorTextStyles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
    >
      <span>{t('builtins.lobe-cloud-sandbox.apiName.writeLocalFile')}: </span>
      <FilePathDisplay filePath={filePath} />
      {lines > 0 && (
        <Text code as={'span'} color={cssVar.colorSuccess} fontSize={12}>
          {' '}
          <Icon icon={Plus} size={12} />
          {lines}
        </Text>
      )}
    </div>
  );
});

WriteLocalFileInspector.displayName = 'WriteLocalFileInspector';
