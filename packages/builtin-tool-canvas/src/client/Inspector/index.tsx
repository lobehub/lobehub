'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CanvasApiNameType, CanvasSaveState } from '../../types';
import { CanvasApiName, CanvasIdentifier } from '../../types';

const styles = stylex.create({
  chip: {
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: 999,
    color: cssVar.colorTextSecondary,
    flexShrink: 1,
    fontSize: 12,
    marginInlineStart: 6,
    minWidth: 0,
    overflow: 'hidden',
    paddingBlock: 2,
    paddingInline: 8,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  failed: {
    backgroundColor: cssVar.colorErrorBg,
    color: cssVar.colorError,
  },
});

type Props = BuiltinInspectorProps<Record<string, any>, CanvasSaveState>;

const createInspector = (apiName: CanvasApiNameType) => {
  const Inspector = memo<Props>((props) => {
    const { t } = useTranslation('plugin');
    const args = { ...props.partialArgs, ...props.args };
    const issueCount = props.pluginState?.issues?.length ?? 0;
    const isSave = apiName === CanvasApiName.createCanvas || apiName === CanvasApiName.updateCanvas;
    const chip = isSave ? (props.pluginState?.title ?? args.title ?? args.canvasId) : args.canvasId;
    const busy = !!(props.isArgumentsStreaming || props.isLoading);

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx(busy && shinyTextStyles.shinyText)}>
          {t(`builtins.${CanvasIdentifier}.apiName.${apiName}`)}
        </span>
        {chip && <span {...stylex.props(styles.chip)}>{chip}</span>}
        {issueCount > 0 && <span {...stylex.props(styles.chip, styles.failed)}>{issueCount}</span>}
      </div>
    );
  });
  Inspector.displayName = `Canvas${apiName}Inspector`;
  return Inspector as unknown as BuiltinInspector;
};

export const CanvasInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(CanvasApiName).map((apiName) => [apiName, createInspector(apiName)]),
);
