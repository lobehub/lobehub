'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PanelLeftOpen } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useParams, useSearchParams } from 'react-router';

import { RouteMetaBridge } from '@/features/RouteMeta';

import { useAcceptanceList } from '../hooks';
import AcceptanceListPanel from './AcceptanceListPanel';
import AcceptanceOnboarding from './AcceptanceOnboarding';
import AcceptanceProjectActions from './AcceptanceProjectActions';
import { useReportPanelExpand } from './useReportPanelExpand';

const renderProjectActions = (projectId?: string) => (
  <AcceptanceProjectActions projectId={projectId} />
);

const styles = createStaticStyles(({ css }) => ({
  expandBtn: css`
    cursor: pointer;

    position: absolute;
    z-index: 20;
    inset-block-start: 12px;
    inset-inline-start: 12px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorBorder};
      color: ${cssVar.colorText};
    }
  `,
  main: css`
    position: relative;

    flex: 1;

    min-width: 0;
    height: 100%;

    background: ${cssVar.colorBgContainer};
  `,
}));

interface AcceptanceOnboardingState {
  data?: unknown[];
  enabled: boolean;
  error?: unknown;
  /**
   * A deep-linked `:acceptanceId` must render even when the viewer's own list
   * is empty — a shared link is often the very first acceptance a user opens,
   * and the install onboarding would swallow it entirely.
   */
  hasDeepLink?: boolean;
  isLoading: boolean;
}

export const shouldShowAcceptanceOnboarding = ({
  data,
  enabled,
  error,
  hasDeepLink,
  isLoading,
}: AcceptanceOnboardingState) =>
  enabled && !hasDeepLink && !isLoading && !error && data?.length === 0;

const AcceptanceWorkspace = memo(() => {
  const { t } = useTranslation('verify');
  const panel = useReportPanelExpand();
  const { acceptanceId, checkId } = useParams<{ acceptanceId: string; checkId: string }>();
  const [searchParams] = useSearchParams();
  const hasFocusedCheck = Boolean(checkId || searchParams.get('check'));
  const showList = !hasFocusedCheck;
  const {
    data: allAcceptances,
    error,
    isLoading,
  } = useAcceptanceList(showList, {
    filter: 'all',
  });
  const isFirstUse = shouldShowAcceptanceOnboarding({
    data: allAcceptances,
    enabled: showList,
    error,
    hasDeepLink: Boolean(acceptanceId),
    isLoading,
  });

  if (isFirstUse) {
    return (
      <>
        <RouteMetaBridge />
        <AcceptanceOnboarding />
      </>
    );
  }

  return (
    <Flexbox horizontal height={'100dvh'} style={{ overflow: 'hidden' }} width={'100%'}>
      <RouteMetaBridge />
      {showList && <AcceptanceListPanel {...panel} renderProjectActions={renderProjectActions} />}
      <div className={styles.main}>
        {showList && !panel.expand && (
          <button
            aria-label={t('workspace.expand')}
            className={styles.expandBtn}
            title={t('workspace.expand')}
            type={'button'}
            onClick={() => panel.setExpand(true)}
          >
            <Icon icon={PanelLeftOpen} size={16} />
          </button>
        )}
        <Outlet />
      </div>
    </Flexbox>
  );
});

AcceptanceWorkspace.displayName = 'AcceptanceWorkspace';

export default AcceptanceWorkspace;
