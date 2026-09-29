'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type {
  AddWidgetToDashboardState,
  DashboardApiNameType,
  DryRunWidgetState,
  GetWidgetRunsState,
  RequestPublishState,
  WidgetDraftState,
} from '../../types';
import { DashboardApiName, DashboardIdentifier } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    flex-shrink: 1;

    min-width: 0;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  failed: css`
    color: ${cssVar.colorError};
    background: ${cssVar.colorErrorBg};
  `,
  succeeded: css`
    color: ${cssVar.colorSuccess};
    background: ${cssVar.colorSuccessBg};
  `,
}));

type Props = BuiltinInspectorProps<Record<string, any>, any>;

/** The one detail worth reading at a glance for each call, from args or the result. */
const useChip = (apiName: DashboardApiNameType, props: Props): ReactNode => {
  const { t } = useTranslation('dashboard');
  const args = { ...props.partialArgs, ...props.args };

  switch (apiName) {
    case DashboardApiName.listDashboards: {
      return undefined;
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
          className={cx(
            styles.chip,
            state.status === 'succeeded'
              ? styles.succeeded
              : state.status !== 'running' && styles.failed,
          )}
        >
          {state.error && state.status !== 'succeeded'
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
        {chip && (typeof chip === 'string' ? <span className={styles.chip}>{chip}</span> : chip)}
      </div>
    );
  });
  Inspector.displayName = `Dashboard${apiName}Inspector`;
  return Inspector as unknown as BuiltinInspector;
};

export const DashboardInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(DashboardApiName).map((apiName) => [apiName, createInspector(apiName)]),
);
