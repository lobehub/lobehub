'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cx, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { GitBranchPlus, ListTree } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import { TopicToolIdentifier } from '../../manifest';
import { TopicToolApiName, type TopicToolApiNameType } from '../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: '0',
    maxWidth: '240px',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  separator: { flexShrink: 0, color: cssVar.colorTextQuaternary },
});

interface TopicToolArgs {
  message?: string;
  prompt?: string;
  title?: string;
  topicId?: string;
}

const createInspector = (api: TopicToolApiNameType) => {
  const TopicToolInspector = memo<BuiltinInspectorProps<TopicToolArgs, { title?: string }>>(
    ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
      const { t } = useTranslation('plugin');
      const params = args || partialArgs || {};
      const label =
        params.title ?? pluginState?.title ?? params.prompt ?? params.message ?? params.topicId;

      return (
        <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
          <Icon
            icon={api === TopicToolApiName.openTopic ? GitBranchPlus : ListTree}
            size={12}
            style={{ color: cssVar.colorInfo }}
          />
          <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
            {t(`builtins.${TopicToolIdentifier}.apiName.${api}`)}
          </span>
          {label && (
            <>
              <span {...stylex.props(styles.separator)}>·</span>
              <span {...stylex.props(styles.chip)}>{label}</span>
            </>
          )}
        </div>
      );
    },
  );
  TopicToolInspector.displayName = `TopicToolInspector(${api})`;
  return TopicToolInspector as BuiltinInspector;
};

export const TopicToolInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(TopicToolApiName).map((api) => [api, createInspector(api)]),
);
