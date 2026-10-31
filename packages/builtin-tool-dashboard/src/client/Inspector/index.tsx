'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type {
  AddWidgetToDashboardState,
  CreateDashboardState,
  DashboardApiNameType,
  DryRunWidgetState,
  GetWidgetRunsState,
  RequestPublishState,
  UpdateDashboardState,
  WidgetDraftState,
} from '../../types';
import { DashboardApiName, DashboardIdentifier } from '../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    flexShrink: 1,
    minWidth: '0',
    marginInlineStart: '6px',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
  failed: { color: cssVar.colorError, background: cssVar.colorErrorBg },
  succeeded: { color: cssVar.colorSuccess, background: cssVar.colorSuccessBg },
});

type Props = BuiltinInspectorProps<Record<string, any>, any>;

/** The one detail worth reading at a glance for each call, from args or the result. */
const useChip = (apiName: DashboardApiNameType, props: Props): ReactNode => {
  const { t } = useTranslation('dashboard');
  const args = { ...props.partialArgs, ...props.args };

  switch (apiName) {
    case DashboardApiName.listDashboards: {
      return undefined;
    }
    case DashboardApiName.createDashboard: {
      const state = props.pluginState as CreateDashboardState | undefined;
      return state?.title ?? args.title;
    }
    case DashboardApiName.createWidgetDraft:
    case DashboardApiName.updateWidgetDraft: {
      const state = props.pluginState as WidgetDraftState | undefined;
      return [args.title, state && `v${state.version}`].filter(Boolean).join(' · ') || undefined;
    }
    case DashboardApiName.dryRunWidget: {
      const state = props.pluginState as DryRunWidgetState | undefined;
      if (!state) return undefined;
      return (
        <span
          {...stylex.props(
            styles.chip,
            state.status === 'succeeded' || state.status === 'partial'
              ? styles.succeeded
              : state.status !== 'running' && styles.failed,
          )}
        >
          {state.error && state.status !== 'succeeded' && state.status !== 'partial'
            ? state.error.code
            : t(`run.status.${state.status}`)}
        </span>
      );
    }
    case DashboardApiName.requestPublish: {
      const state = props.pluginState as RequestPublishState | undefined;
      return state ? t('chat.preview.live', { version: state.version }) : undefined;
    }
    case DashboardApiName.addWidgetToDashboard: {
      const state = props.pluginState as AddWidgetToDashboardState | undefined;
      return state?.dashboardTitle ?? args.newDashboardTitle;
    }
    case DashboardApiName.updateDashboard: {
      const state = props.pluginState as UpdateDashboardState | undefined;
      return state?.title ?? args.title;
    }
    case DashboardApiName.getWidgetRuns: {
      const state = props.pluginState as GetWidgetRunsState | undefined;
      return state ? String(state.runs.length) : undefined;
    }
  }
};

const createInspector = (apiName: DashboardApiNameType) => {
  const Inspector = memo<Props>((props) => {
    const { t } = useTranslation('plugin');
    const chip = useChip(apiName, props);

    return (
      <div className={inspectorTextStyles.root}>
        <span
          className={cx(
            (props.isArgumentsStreaming || props.isLoading) && shinyTextStyles.shinyText,
          )}
        >
          {t(`builtins.${DashboardIdentifier}.apiName.${apiName}`)}
        </span>
        {chip &&
          (typeof chip === 'string' ? <span {...stylex.props(styles.chip)}>{chip}</span> : chip)}
      </div>
    );
  });
  Inspector.displayName = `Dashboard${apiName}Inspector`;
  return Inspector as unknown as BuiltinInspector;
};

export const DashboardInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(DashboardApiName).map((apiName) => [apiName, createInspector(apiName)]),
);
