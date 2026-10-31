'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, Monitor as MonitorIcon, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type MonitorArgs } from '../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    marginInlineStart: '6px',
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    background: cssVar.colorFillTertiary,
  },
  command: {
    overflow: 'hidden',
    minWidth: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  description: {
    overflow: 'hidden',
    minWidth: '0',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  monitorIcon: { flexShrink: 0, color: cssVar.colorTextDescription },
  statusIcon: { marginInlineStart: '4px' },
  timeout: {
    flexShrink: 0,
    marginInlineStart: '8px',
    fontFeatureSettings: "'tnum'",
    color: cssVar.colorTextDescription,
  },
});

const formatTimeout = (ms: number | undefined): string | undefined => {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return undefined;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) {
    return remSeconds > 0 ? `${minutes}m ${remSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
};

/**
 * Dedicated inspector for CC's long-running `Monitor` tool ().
 *
 * Visual contract:
 *   [Monitor] <MonitorIcon>  <description-or-command>  · <timeout>   [✓/✗]
 *
 * Uses the lucide `Monitor` (screen) icon so the chip iconography matches
 * the tool name. Falls back to `command` when the model omits
 * `description`; renders a code-styled chip in that case to make the
 * shell snippet recognizable.
 */
export const MonitorInspector = memo<BuiltinInspectorProps<MonitorArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.Monitor as any);

    const source = args ?? partialArgs;
    const description = source?.description?.trim();
    const command = source?.command?.trim();
    const timeoutLabel = formatTimeout(source?.timeout_ms);

    const isShiny = isArgumentsStreaming || isLoading;

    // Nothing useful to show yet — keep the spinner-y label only.
    if (isArgumentsStreaming && !description && !command) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    // Prefer description; fall back to command (rendered monospace).
    const showAsCommand = !description && !!command;
    const chipText = description || command;

    const success = (pluginState as { success?: boolean } | undefined)?.success;
    const exitCode = (pluginState as { exitCode?: number } | undefined)?.exitCode;
    const isSuccess = success === true || exitCode === 0;
    const isError = success === false || (typeof exitCode === 'number' && exitCode !== 0);

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx(isShiny && shinyTextStyles.shinyText)}>{label}:</span>
        {chipText && (
          <span {...stylex.props(styles.chip)}>
            <MonitorIcon className={stylex.props(styles.monitorIcon).className} size={12} />
            <span {...stylex.props(showAsCommand ? styles.command : styles.description)}>
              {chipText}
            </span>
          </span>
        )}
        {timeoutLabel && <span {...stylex.props(styles.timeout)}>· {timeoutLabel}</span>}
        {isLoading ? null : isSuccess ? (
          <Check
            className={stylex.props(styles.statusIcon).className}
            color={cssVar.colorSuccess}
            size={14}
          />
        ) : isError ? (
          <X
            className={stylex.props(styles.statusIcon).className}
            color={cssVar.colorError}
            size={14}
          />
        ) : null}
      </div>
    );
  },
);

MonitorInspector.displayName = 'ClaudeCodeMonitorInspector';
