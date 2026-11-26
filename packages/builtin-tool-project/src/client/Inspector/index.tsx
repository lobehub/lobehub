'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ProjectApiNameType, ProjectToolState } from '../../types';
import { ProjectApiName, ProjectIdentifier } from '../../types';

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

type Props = BuiltinInspectorProps<Record<string, any>, ProjectToolState>;

const createInspector = (apiName: ProjectApiNameType) => {
  const Inspector = memo<Props>((props) => {
    const { t } = useTranslation('plugin');
    const args = { ...props.partialArgs, ...props.args };
    // The folder being added or the runner being removed; nothing for reads.
    const chip = args.path ?? args.runnerId;
    const busy = !!(props.isArgumentsStreaming || props.isLoading);

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx(busy && shinyTextStyles.shinyText)}>
          {t(`builtins.${ProjectIdentifier}.apiName.${apiName}`)}
        </span>
        {typeof chip === 'string' && chip && <span {...stylex.props(styles.chip)}>{chip}</span>}
      </div>
    );
  });
  Inspector.displayName = `Project${apiName}Inspector`;
  return Inspector as unknown as BuiltinInspector;
};

export const ProjectInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(ProjectApiName).map((apiName) => [apiName, createInspector(apiName)]),
);
