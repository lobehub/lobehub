'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PanelLeftOpen } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { RouteMetaBridge } from '@/features/RouteMeta';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { useReportPanelExpand } from '../../Workspace/useReportPanelExpand';
import AcceptanceListPanel from './AcceptanceListPanel';

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

/**
 * Acceptance workspace shell — the acceptance twin of {@link VerifyWorkspace}:
 * a persistent, collapsible acceptance-list panel on the left and the selected
 * aggregate (or the empty placeholder) rendered through the router `Outlet`.
 * An anonymous visitor holding a public acceptance link gets only the detail —
 * the list is the owner's, so it renders for signed-in users alone.
 */
const AcceptanceWorkspace = memo(() => {
  const { t } = useTranslation('verify');
  const panel = useReportPanelExpand();
  const isAuthLoaded = useUserStore(authSelectors.isLoaded);
  const isLogin = useUserStore(authSelectors.isLogin);
  const canShowList = Boolean(isAuthLoaded && isLogin);

  return (
    <Flexbox horizontal height={'100dvh'} style={{ overflow: 'hidden' }} width={'100%'}>
      {/* Standalone route (outside the app main layout): drive the tab title here. */}
      <RouteMetaBridge />
      {canShowList && <AcceptanceListPanel {...panel} />}
      <div className={styles.main}>
        {canShowList && !panel.expand && (
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
