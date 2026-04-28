'use client';

import type { RunCommandState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, SquareChevronRight, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '../../styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    gap: 6px;
    align-items: center;

    min-width: 0;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    background: ${cssVar.colorFillTertiary};
  `,
  command: css`
    overflow: hidden;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  statusIcon: css`
    margin-inline-start: 4px;
  `,
  terminalIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextDescription};
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
          <span>{t(translationKey as any)}:</span>
          <span className={styles.chip}>
            <SquareChevronRight className={styles.terminalIcon} size={14} />
            <span className={styles.command}>{description}</span>
          </span>
        </div>
      );
    }

    const isSuccess = pluginState?.success || pluginState?.exitCode === 0;

    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <span>{t(translationKey as any)}:</span>
        {description && (
          <span className={styles.chip}>
            <SquareChevronRight className={styles.terminalIcon} size={14} />
            <span className={styles.command}>{description}</span>
          </span>
        )}
        {isLoading ? null : pluginState?.success !== undefined ? (
          isSuccess ? (
            <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
          ) : (
            <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
          )
        ) : null}
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
