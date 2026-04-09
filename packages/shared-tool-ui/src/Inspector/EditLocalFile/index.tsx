'use client';

import type { EditFileState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FilePathDisplay } from '../../components/FilePathDisplay';
import { inspectorTextStyles, shinyTextStyles } from '../../styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  separator: css`
    margin-inline: 2px;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface EditFileArgs {
  all?: boolean;
  file_path?: string;
  path?: string;
  replace?: string;
  search?: string;
}

export interface EditLocalFileInspectorProps extends BuiltinInspectorProps<
  EditFileArgs,
  EditFileState
> {
  translationKey: string;
}

export const EditLocalFileInspector = memo<EditLocalFileInspectorProps>(
  ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading, translationKey }) => {
    const { t } = useTranslation('plugin');

    const filePath =
      args?.file_path || args?.path || partialArgs?.file_path || partialArgs?.path || '';

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

    const linesAdded = pluginState?.linesAdded ?? 0;
    const linesDeleted = pluginState?.linesDeleted ?? 0;

    const statsParts: ReactNode[] = [];
    if (linesAdded > 0) {
      statsParts.push(
        <Text code as={'span'} color={cssVar.colorSuccess} fontSize={12} key="added">
          <Icon icon={Plus} size={12} />
          {linesAdded}
        </Text>,
      );
    }
    if (linesDeleted > 0) {
      statsParts.push(
        <Text code as={'span'} color={cssVar.colorError} fontSize={12} key="deleted">
          <Icon icon={Minus} size={12} />
          {linesDeleted}
        </Text>,
      );
    }

    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <span>{t(translationKey as any)}: </span>
        <FilePathDisplay filePath={filePath} />
        {!isLoading && statsParts.length > 0 && (
          <>
            {' '}
            {statsParts.map((part, index) => (
              <span key={index}>
                {index > 0 && <span className={styles.separator}> / </span>}
                {part}
              </span>
            ))}
          </>
        )}
      </div>
    );
  },
);

EditLocalFileInspector.displayName = 'EditLocalFileInspector';

export const createEditLocalFileInspector = (translationKey: string) => {
  const Inspector = memo<BuiltinInspectorProps<any, any>>((props) => (
    <EditLocalFileInspector {...props} translationKey={translationKey} />
  ));
  Inspector.displayName = 'EditLocalFileInspector';
  return Inspector;
};
