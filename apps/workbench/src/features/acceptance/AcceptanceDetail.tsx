'use client';

import { Flexbox } from '@lobehub/ui/es/Flex/index';
import Text from '@lobehub/ui/es/Text/index';
import { createStaticStyles, cssVar } from 'antd-style';
import { Component, lazy, memo, type PropsWithChildren, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import useSWR from 'swr';

import AcceptanceViewer from '@/features/Verify/Acceptance';
import { useAcceptanceBundle } from '@/features/Verify/hooks';
import { extractUuid } from '@/features/Verify/utils';
import { useIsHydrated } from '@/hooks/useIsHydrated';
import { verifyKeys } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import WorkbenchBrandLink from '../../shell/WorkbenchBrandLink';
import SWRMutateInitializer from './SWRMutateInitializer';

// The sidebar pulls the global store (panel-width preference) and the list
// panel stack — lazy so the SSR graph and anonymous visitors never load it.
const workspaceSidebarMod = () => import('./WorkspaceSidebar');
const WorkspaceSidebar = lazy(workspaceSidebarMod);
const HeaderBrand = lazy(() => workspaceSidebarMod().then((mod) => ({ default: mod.HeaderBrand })));

// The list panel is auxiliary — a crash inside it must degrade to "no
// sidebar", never take the report page down with it.
class SidebarBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[workbench] acceptance sidebar crashed:', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: hidden;
    flex: 1;
    min-height: 0;
  `,
  header: css`
    flex: none;

    min-height: 48px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  main: css`
    flex: 1;
    min-width: 0;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  page: css`
    position: relative;
    width: 100%;
    height: 100dvh;
    background: ${cssVar.colorBgContainer};
  `,
}));

const WorkbenchAcceptanceDetail = memo(() => {
  const { t } = useTranslation('verify');
  const params = useParams<{ acceptanceId: string; checkId?: string }>();
  const acceptanceId = extractUuid(params.acceptanceId);
  const { data } = useAcceptanceBundle(acceptanceId ?? null);
  const hydrated = useIsHydrated();
  const [searchParams] = useSearchParams();
  const hasFocusedCheck = Boolean(params.checkId || searchParams.get('check'));

  // Signed-in detection without the user store (workbench never initializes
  // it): the owner list is cookie-authed, so a successful fetch IS the login
  // signal. Quiet + swallowed so an anonymous visitor's 401 stays silent.
  const { data: workspaceList } = useSWR(
    hydrated && !hasFocusedCheck ? verifyKeys.acceptances() : null,
    () =>
      verifyService.listAcceptances({ quiet: true }).catch((error) => {
        console.warn('[workbench] acceptance list probe failed:', error);
        return null;
      }),
    { revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  const showSidebar = Boolean(workspaceList) && !hasFocusedCheck;

  return (
    <Flexbox horizontal className={styles.page}>
      {showSidebar && (
        <SidebarBoundary>
          <Suspense fallback={null}>
            <WorkspaceSidebar />
          </Suspense>
        </SidebarBoundary>
      )}
      <Flexbox className={styles.main}>
        <SWRMutateInitializer />
        <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
          {showSidebar ? (
            <Suspense fallback={<WorkbenchBrandLink />}>
              <HeaderBrand />
            </Suspense>
          ) : (
            <WorkbenchBrandLink />
          )}
          <Text ellipsis strong style={{ minWidth: 0 }}>
            {data?.subject.title ?? t('acceptance.titleFallback')}
          </Text>
        </Flexbox>
        <div className={styles.body}>
          <AcceptanceViewer />
        </div>
      </Flexbox>
    </Flexbox>
  );
});

WorkbenchAcceptanceDetail.displayName = 'WorkbenchAcceptanceDetail';

export default WorkbenchAcceptanceDetail;
