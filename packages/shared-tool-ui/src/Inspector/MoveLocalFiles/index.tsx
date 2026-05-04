'use client';

import type { MoveFilesState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '../../styles';

interface MoveFilesArgs {
  items?: Array<{ newPath?: string; oldPath?: string }>;
  operations?: Array<{ destination?: string; source?: string }>;
}

export const createMoveLocalFilesInspector = (translationKey: string) => {
  const Inspector = memo<BuiltinInspectorProps<MoveFilesArgs, MoveFilesState>>(
    ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
      const { t } = useTranslation('plugin');

      const sourceArgs = args || partialArgs || {};
      const itemsCount = sourceArgs.operations?.length ?? sourceArgs.items?.length ?? 0;

      const totalCount = pluginState?.totalCount ?? itemsCount;
      const successCount = pluginState?.successCount;
      const allSucceeded =
        successCount !== undefined && totalCount > 0 && successCount === totalCount;

      const showShiny = isArgumentsStreaming || isLoading;

      return (
        <div className={cx(inspectorTextStyles.root, showShiny && shinyTextStyles.shinyText)}>
          <span style={{ marginInlineEnd: 6 }}>{t(translationKey as any)}</span>
          {totalCount > 0 && (
            <Text code as={'span'} fontSize={12}>
              {successCount === undefined ? totalCount : `${successCount}/${totalCount}`}
            </Text>
          )}
          {!isLoading && successCount !== undefined && (
            <span style={{ marginInlineStart: 4 }}>
              {allSucceeded ? (
                <Icon color={cssVar.colorSuccess} icon={Check} size={14} />
              ) : (
                <Icon color={cssVar.colorError} icon={X} size={14} />
              )}
            </span>
          )}
        </div>
      );
    },
  );
  Inspector.displayName = 'MoveLocalFilesInspector';
  return Inspector;
};
