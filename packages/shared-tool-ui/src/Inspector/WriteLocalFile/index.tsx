'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FilePathDisplay } from '../../components/FilePathDisplay';
import { inspectorTextStyles, shinyTextStyles } from '../../styles';

interface WriteFileArgs {
  content?: string;
  path?: string;
}

export const createWriteLocalFileInspector = (translationKey: string) => {
  const Inspector = memo<BuiltinInspectorProps<WriteFileArgs, any>>(
    ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
      const { t } = useTranslation('plugin');

      const filePath = args?.path || partialArgs?.path || '';
      const lineCount = args?.content?.split('\n').length;

      if (isArgumentsStreaming) {
        if (!filePath)
          return (
            <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
              <span>{t(translationKey as any)}</span>
            </div>
          );

        return (
          <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
            <span>{t(translationKey as any)}: </span>
            <FilePathDisplay filePath={filePath} />
          </div>
        );
      }

      return (
        <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
          <span>{t(translationKey as any)}: </span>
          <FilePathDisplay filePath={filePath} />
          {!isLoading && lineCount && (
            <>
              {' '}
              <Text code as={'span'} color={cssVar.colorSuccess} fontSize={12}>
                <Icon icon={Plus} size={12} />
                {lineCount}
              </Text>
            </>
          )}
        </div>
      );
    },
  );
  Inspector.displayName = 'WriteLocalFileInspector';
  return Inspector;
};
