'use client';

import type { RunCommandState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, SquareChevronRight, X } from 'lucide-react';
import { type ComponentType, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '../../styles';
import { getRunCommandDisplayCommand } from '../../utils/runCommand';

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
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
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
  leadingIcon: { flexShrink: 0, marginInlineEnd: '6px', color: cssVar.colorTextDescription },
  statusIcon: { flexShrink: 0, marginInlineStart: '4px' },
  terminalIcon: { flexShrink: 0, color: cssVar.colorTextDescription },
});

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
  /**
   * Program brand icon (e.g. Node.js / Git / Python). When provided it leads the whole row —
   * placed before the label — and the command chip drops its terminal glyph. When omitted, the
   * default terminal glyph stays inside the command chip.
   */
  icon?: ComponentType<{ className?: string; size?: number }>;
  /** i18n key for the API name label, e.g. 'builtins.lobe-local-system.apiName.runCommand' */
  translationKey: string;
}

export const RunCommandInspector = memo<RunCommandInspectorProps>(
  ({
    args,
    partialArgs,
    isArgumentsStreaming,
    pluginState,
    isLoading,
    translationKey,
    icon: BrandIcon,
  }) => {
    const { t } = useTranslation('plugin');

    const command = getRunCommandDisplayCommand(args?.command || partialArgs?.command);
    const description = args?.description || partialArgs?.description || command;

    // Brand icon leads the row (before the label); otherwise the terminal glyph sits in the chip.
    const leading = BrandIcon ? (
      <BrandIcon className={stylex.props(styles.leadingIcon).className} size={14} />
    ) : null;
    const chipIcon = BrandIcon ? null : (
      <SquareChevronRight className={stylex.props(styles.terminalIcon).className} size={14} />
    );

    if (isArgumentsStreaming) {
      if (!description)
        return (
          <div className={inspectorTextStyles.root}>
            {leading}
            <span className={shinyTextStyles.shinyText}>{t(translationKey as any)}</span>
          </div>
        );

      return (
        <div className={inspectorTextStyles.root}>
          {leading}
          <span className={shinyTextStyles.shinyText}>{t(translationKey as any)}:</span>
          <span {...stylex.props(styles.chip)}>
            {chipIcon}
            <span {...stylex.props(styles.command)}>{description}</span>
          </span>
        </div>
      );
    }

    const isSuccess = pluginState?.success || pluginState?.exitCode === 0;

    return (
      <div className={inspectorTextStyles.root}>
        {leading}
        <span className={cx(isLoading && shinyTextStyles.shinyText)}>
          {t(translationKey as any)}:
        </span>
        {description && (
          <span {...stylex.props(styles.chip)}>
            {chipIcon}
            <span {...stylex.props(styles.command)}>{description}</span>
          </span>
        )}
        {isLoading ? null : pluginState?.success !== undefined ? (
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
