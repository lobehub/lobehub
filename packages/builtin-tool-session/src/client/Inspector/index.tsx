'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cx, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { GitBranchPlus, ListTree } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import { SessionIdentifier } from '../../manifest';
import { SessionApiName, type SessionApiNameType } from '../../types';

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

interface SessionArgs {
  message?: string;
  prompt?: string;
  title?: string;
  topicId?: string;
}

const createInspector = (api: SessionApiNameType) => {
  const SessionInspector = memo<BuiltinInspectorProps<SessionArgs, { title?: string }>>(
    ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
      const { t } = useTranslation('plugin');
      const params = args || partialArgs || {};
      const label =
        params.title ?? pluginState?.title ?? params.prompt ?? params.message ?? params.topicId;

      return (
        <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
          <Icon
            icon={api === SessionApiName.startSession ? GitBranchPlus : ListTree}
            size={12}
            style={{ color: cssVar.colorInfo }}
          />
          <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
            {t(`builtins.${SessionIdentifier}.apiName.${api}`)}
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
  SessionInspector.displayName = `SessionInspector(${api})`;
  return SessionInspector as BuiltinInspector;
};

export const SessionInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(SessionApiName).map((api) => [api, createInspector(api)]),
);
