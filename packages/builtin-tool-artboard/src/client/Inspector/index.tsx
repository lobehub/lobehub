'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ArtboardApiNameType, ArtboardToolState } from '../../types';
import { ArtboardApiName, ArtboardIdentifier } from '../../types';

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
});

type Props = BuiltinInspectorProps<Record<string, any>, ArtboardToolState>;

const createInspector = (apiName: ArtboardApiNameType) => {
  const Inspector = memo<Props>((props) => {
    const { t } = useTranslation('plugin');
    const args = { ...props.partialArgs, ...props.args };
    const chip = props.pluginState?.title ?? args.title ?? args.id;
    const busy = !!(props.isArgumentsStreaming || props.isLoading);

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx(busy && shinyTextStyles.shinyText)}>
          {t(`builtins.${ArtboardIdentifier}.apiName.${apiName}`)}
        </span>
        {chip && <span {...stylex.props(styles.chip)}>{chip}</span>}
      </div>
    );
  });
  Inspector.displayName = `Artboard${apiName}Inspector`;
  return Inspector as unknown as BuiltinInspector;
};

export const ArtboardInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(ArtboardApiName).map((apiName) => [apiName, createInspector(apiName)]),
);
