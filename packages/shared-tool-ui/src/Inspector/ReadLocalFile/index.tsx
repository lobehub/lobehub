'use client';

import type { ReadFileState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FilePathDisplay } from '../../components/FilePathDisplay';
import { inspectorTextStyles, shinyTextStyles } from '../../styles';

interface ReadFileArgs {
  endLine?: number;
  loc?: [number, number];
  path?: string;
  startLine?: number;
}

export const createReadLocalFileInspector = (translationKey: string) => {
  const Inspector = memo<BuiltinInspectorProps<ReadFileArgs, ReadFileState>>(
    ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
      const { t } = useTranslation('plugin');

      const filePath = args?.path || partialArgs?.path || '';

      const lineRange = useMemo(() => {
        const start = args?.startLine ?? args?.loc?.[0];
        const end = args?.endLine ?? args?.loc?.[1];
        if (start !== undefined && end !== undefined) return `L${start}-L${end}`;
        if (start !== undefined) return `L${start}`;
        return undefined;
      }, [args]);

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
          {lineRange && <span style={{ marginInlineStart: 4 }}>({lineRange})</span>}
        </div>
      );
    },
  );
  Inspector.displayName = 'ReadLocalFileInspector';
  return Inspector;
};
