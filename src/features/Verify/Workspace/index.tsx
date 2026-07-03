'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PanelLeftOpen } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { RouteMetaBridge } from '@/features/RouteMeta';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import ReportListPanel from './ReportListPanel';

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
  `,
}));

/**
 * Verify workspace shell — a master-detail layout: a persistent, collapsible /
 * drag-resizable report-list panel on the left, and the selected report (or the
 * empty placeholder) rendered through the router `Outlet` on the right.
 */
const VerifyWorkspace = memo(() => {
  const { t } = useTranslation('verify');
  const [showPanel, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.showVerifyReportPanel(s),
    s.updateSystemStatus,
  ]);

  return (
    <Flexbox horizontal height={'100dvh'} style={{ overflow: 'hidden' }} width={'100%'}>
      {/* Standalone route (outside the app main layout): drive the tab title here. */}
      <RouteMetaBridge />
      <ReportListPanel />
      <div className={styles.main}>
        {!showPanel && (
          <button
            aria-label={t('workspace.expand')}
            className={styles.expandBtn}
            title={t('workspace.expand')}
            type={'button'}
            onClick={() => updateSystemStatus({ showVerifyReportPanel: true })}
          >
            <Icon icon={PanelLeftOpen} size={16} />
          </button>
        )}
        <Outlet />
      </div>
    </Flexbox>
  );
});

VerifyWorkspace.displayName = 'VerifyWorkspace';

export default VerifyWorkspace;
