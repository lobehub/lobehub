'use client';

import type { GlobFilesState } from '@lobechat/tool-runtime';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '../../styles';

const styles = stylex.create({
  baseline: { alignItems: 'baseline' },
  statusIcon: { alignSelf: 'center', marginInlineStart: '4px' },
  tag: {
    marginInlineStart: '6px',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

interface GlobFilesArgs {
  directory?: string;
  pattern?: string;
}

export const createGlobLocalFilesInspector = (translationKey: string) => {
  const Inspector = memo<BuiltinInspectorProps<GlobFilesArgs, GlobFilesState>>(
    ({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
      const { t } = useTranslation('plugin');

      const pattern = args?.pattern || partialArgs?.pattern || '';

      if (isArgumentsStreaming) {
        if (!pattern)
          return (
            <div className={inspectorTextStyles.root}>
              <span className={shinyTextStyles.shinyText}>{t(translationKey as any)}</span>
            </div>
          );

        return (
          <div className={cx(stylex.props(styles.baseline).className, inspectorTextStyles.root)}>
            <span className={shinyTextStyles.shinyText}>{t(translationKey as any)}:</span>
            <span {...stylex.props(styles.tag)}>{pattern}</span>
          </div>
        );
      }

      const hasFiles = (pluginState?.totalCount ?? 0) > 0;

      return (
        <div className={cx(stylex.props(styles.baseline).className, inspectorTextStyles.root)}>
          <span className={cx(isLoading && shinyTextStyles.shinyText)}>
            {t(translationKey as any)}:
          </span>
          {pattern && <span {...stylex.props(styles.tag)}>{pattern}</span>}
          {isLoading ? null : pluginState ? (
            hasFiles ? (
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
  Inspector.displayName = 'GlobLocalFilesInspector';
  return Inspector;
};
