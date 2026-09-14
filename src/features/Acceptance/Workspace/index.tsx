'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Drawer } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Menu, PanelLeftOpen } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate, useParams, useSearchParams } from 'react-router';

import { ShellTopBar } from '@/features/PageShell';
import { RouteMetaBridge } from '@/features/RouteMeta';

import { useAcceptanceList } from '../hooks';
import { acceptanceHomePath } from '../Viewer/routes';
import AcceptanceListPanel from './AcceptanceListPanel';
import AcceptanceOnboarding from './AcceptanceOnboarding';
import { useAcceptanceProjectActionItems } from './AcceptanceProjectActions';
import { useReportPanelExpand } from './useReportPanelExpand';

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
  hasDeepLink?: boolean;
  isLoading?: boolean;
}

export const shouldShowAcceptanceOnboarding = ({
  data,
  enabled,
  error,
  hasDeepLink,
  isLoading,
}: AcceptanceOnboardingState) =>
  enabled && !hasDeepLink && !isLoading && !error && data?.length === 0;

interface AcceptanceWorkspaceProps {
  projectId?: string;
}

const AcceptanceWorkspace = memo<AcceptanceWorkspaceProps>(({ projectId }) => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const panel = useReportPanelExpand();
  const projectActionItems = useAcceptanceProjectActionItems();
  const { acceptanceId, checkId } = useParams<{ acceptanceId: string; checkId: string }>();
  const [searchParams] = useSearchParams();
  const hasFocusedCheck = Boolean(checkId || searchParams.get('check'));

  /**
   * Inside a project the workspace is already wearing the `(main)` shell's
   * chrome, so it keeps its inline rail. Only the standalone `/acceptance`
   * route — registered outside `(main)`, with nothing above it — grows a top
   * bar of its own, and there the list becomes a drawer so a record can own
   * the full width without the collection having to disappear to give it.
   */
  const standalone = !projectId;
  const showList = !hasFocusedCheck;
  const [listOpen, setListOpen] = useState(false);
  // Picking a row is what the drawer was opened to cause; once the route has
  // changed the drawer has nothing left to do.
  useEffect(() => {
    setListOpen(false);
  }, [acceptanceId]);

  const {
    data: allAcceptances,
    error,
    isLoading,
  } = useAcceptanceList(standalone ? !acceptanceId : showList, {
    filter: 'all',
    projectId,
  });
  const isFirstUse = shouldShowAcceptanceOnboarding({
    data: allAcceptances,
    enabled: standalone ? !acceptanceId : showList && !projectId,
    error,
    hasDeepLink: Boolean(acceptanceId),
    isLoading,
  });

  const topBar = standalone ? (
    <ShellTopBar
      title={t('acceptance.workspace.title')}
      titleExtra={
        <ActionIcon
          icon={Menu}
          size={'small'}
          title={t('acceptance.shell.menu')}
          onClick={() => setListOpen(true)}
        />
      }
      onBack={() => navigate(acceptanceHomePath())}
    />
  ) : null;

  if (isFirstUse) {
    return standalone ? (
      <Flexbox height={'100dvh'} style={{ overflow: 'hidden' }} width={'100%'}>
        <RouteMetaBridge />
        {topBar}
        <AcceptanceOnboarding />
      </Flexbox>
    ) : (
      <>
        <RouteMetaBridge />
        <AcceptanceOnboarding />
      </>
    );
  }

  if (!standalone)
    return (
      <Flexbox horizontal height={'100dvh'} style={{ overflow: 'hidden' }} width={'100%'}>
        <RouteMetaBridge />
        {showList && (
          <AcceptanceListPanel
            {...panel}
            projectActionItems={projectActionItems}
            projectId={projectId}
          />
        )}
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

  return (
    <Flexbox height={'100dvh'} style={{ overflow: 'hidden' }} width={'100%'}>
      <RouteMetaBridge />
      {topBar}
      <Drawer
        noHeader
        closable={false}
        containerMaxWidth={'100%'}
        open={listOpen}
        placement={'left'}
        styles={{ bodyContent: { height: '100%', minHeight: 0, overflow: 'hidden', padding: 0 } }}
        width={'min(360px, 88vw)'}
        onClose={() => setListOpen(false)}
      >
        <AcceptanceListPanel hosted {...panel} projectActionItems={projectActionItems} />
      </Drawer>
      <Flexbox horizontal flex={1} style={{ minHeight: 0 }} width={'100%'}>
        <div className={styles.main}>
          <Outlet />
        </div>
      </Flexbox>
    </Flexbox>
  );
});

AcceptanceWorkspace.displayName = 'AcceptanceWorkspace';

export default AcceptanceWorkspace;
