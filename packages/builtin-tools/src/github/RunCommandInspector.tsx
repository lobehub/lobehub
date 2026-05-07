'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';

import { getGhSubcommand, type GithubRunCommandArgs, type GithubRunCommandState } from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    gap: 6px;
    align-items: center;

    min-width: 0;
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
  ghPrefix: css`
    flex-shrink: 0;

    margin-inline-end: 6px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  icon: css`
    flex-shrink: 0;
    margin-inline-end: 6px;
    color: ${cssVar.colorTextDescription};
  `,
  statusIcon: css`
    margin-inline-start: 4px;
  `,
}));

const GithubRunCommandInspector = memo<
  BuiltinInspectorProps<GithubRunCommandArgs, GithubRunCommandState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const command = args?.command || partialArgs?.command || '';
  const description = args?.description || partialArgs?.description || '';
  const subcommand = getGhSubcommand(command);
  const label = description || subcommand;

  const pulse = isArgumentsStreaming || isLoading;
  const isSuccess = pluginState?.success ?? pluginState?.exitCode === 0;
  const hasResult = !pulse && pluginState && pluginState.success !== undefined;

  return (
    <div className={cx(inspectorTextStyles.root, pulse && shinyTextStyles.shinyText)}>
      <Github className={styles.icon} size={14} />
      <span className={styles.ghPrefix}>gh</span>
      {label && (
        <span className={styles.chip}>
          <span className={styles.command}>{label}</span>
        </span>
      )}
      {hasResult ? (
        isSuccess ? (
          <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
        ) : (
          <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
        )
      ) : null}
    </div>
  );
});

GithubRunCommandInspector.displayName = 'GithubRunCommandInspector';

export default GithubRunCommandInspector;
