'use client';

import { FilePathDisplay } from '@lobechat/shared-tool-ui/components';
import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExportFileState } from '../../../types';

interface ExportFileArgs {
  path?: string;
}

export const ExportFileInspector = memo<BuiltinInspectorProps<ExportFileArgs, ExportFileState>>(
  ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
    const { t } = useTranslation('plugin');

    const filePath = args?.path || partialArgs?.path || '';
    const showShiny = isArgumentsStreaming || isLoading;

    return (
      <div className={cx(inspectorTextStyles.root, showShiny && shinyTextStyles.shinyText)}>
        <span style={{ marginInlineEnd: 6 }}>
          {t('builtins.lobe-cloud-sandbox.apiName.exportFile')}:
        </span>
        {filePath && <FilePathDisplay filePath={filePath} />}
        {!isLoading && pluginState !== undefined && (
          <span style={{ marginInlineStart: 4 }}>
            {pluginState.success ? (
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

ExportFileInspector.displayName = 'ExportFileInspector';
