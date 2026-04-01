'use client';

import type { RunCommandState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '../../styles';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

interface RunCommandArgs {
  background?: boolean;
  command: string;
  description?: string;
  timeout?: number;
}

export interface RunCommandInspectorProps extends BuiltinInspectorProps<
  RunCommandArgs,
  RunCommandState
> {
  /** i18n key for the API name label, e.g. 'builtins.lobe-local-system.apiName.runCommand' */
  translationKey: string;
}

export const RunCommandInspector = memo<RunCommandInspectorProps>(
  ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading, translationKey }) => {
    const { t } = useTranslation('plugin');

    const description = args?.description || partialArgs?.description || args?.command || '';

    if (isArgumentsStreaming) {
      if (!description)
        return (
          <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
            <span>{t(translationKey as any)}</span>
          </div>
        );

      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t(translationKey as any)}: </span>
          <span className={highlightTextStyles.primary}>{description}</span>
        </div>
      );
    }

    const isSuccess = pluginState?.success || pluginState?.exitCode === 0;

    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <span style={{ marginInlineStart: 2 }}>
          <span>{t(translationKey as any)}: </span>
          {description && <span className={highlightTextStyles.primary}>{description}</span>}
          {isLoading ? null : pluginState?.success !== undefined ? (
            isSuccess ? (
              <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
            ) : (
              <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
            )
          ) : null}
        </span>
      </div>
    );
  },
);

RunCommandInspector.displayName = 'RunCommandInspector';

/**
 * Factory to create a RunCommandInspector with a bound translation key.
 * Use this in each package's inspector registry to avoid wrapper components.
 */
export const createRunCommandInspector = (translationKey: string) => {
  const Inspector = memo<BuiltinInspectorProps<RunCommandArgs, RunCommandState>>((props) => (
    <RunCommandInspector {...props} translationKey={translationKey} />
  ));
  Inspector.displayName = 'RunCommandInspector';
  return Inspector;
};
