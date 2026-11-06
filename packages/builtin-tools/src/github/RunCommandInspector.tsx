'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, X } from 'lucide-react';
import { memo } from 'react';

import { getGhSubcommand, type GithubRunCommandArgs, type GithubRunCommandState } from './utils';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',
    minWidth: 0,
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  command: {
    overflow: 'hidden',
    minWidth: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ghPrefix: {
    flexShrink: 0,
    marginInlineEnd: '6px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
  },
  ghPrefixColor: { color: cssVar.colorTextDescription },
  icon: { flexShrink: 0, marginInlineEnd: '6px', color: cssVar.colorTextDescription },
  statusIcon: { marginInlineStart: '4px' },
});

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
    <div className={inspectorTextStyles.root}>
      <Github className={stylex.props(styles.icon).className} size={14} />
      <span
        className={cx(
          stylex.props(styles.ghPrefix, !pulse && styles.ghPrefixColor).className,
          pulse && shinyTextStyles.shinyText,
        )}
      >
        gh
      </span>
      {label && (
        <span {...stylex.props(styles.chip)}>
          <span {...stylex.props(styles.command)}>{label}</span>
        </span>
      )}
      {hasResult ? (
        isSuccess ? (
          <Check
            className={stylex.props(styles.statusIcon).className}
            color={cssVar.colorSuccess}
            size={14}
          />
        ) : (
          <X
            className={stylex.props(styles.statusIcon).className}
            color={cssVar.colorError}
            size={14}
          />
        )
      ) : null}
    </div>
  );
});

GithubRunCommandInspector.displayName = 'GithubRunCommandInspector';

export default GithubRunCommandInspector;
