'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { PanelLeftOpen } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AcceptanceListPanel from '@/features/Verify/Acceptance/Workspace/AcceptanceListPanel';
import { useReportPanelExpand } from '@/features/Verify/Workspace/useReportPanelExpand';

import WorkbenchBrandLink, {
  WorkbenchBrandCluster,
  WorkbenchBrandSlot,
} from '../../shell/WorkbenchBrandLink';

// AcceptanceRow calls dayjs().fromNow(); the main app extends this plugin in
// src/initialize.ts, which workbench never runs.
dayjs.extend(relativeTime);

const styles = createStaticStyles(({ css }) => ({
  brandOverlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 30;
    inset-block-start: 0;
    inset-inline-start: 0;

    display: flex;
    align-items: center;

    height: 48px;
    padding-inline-start: 12px;

    transition: padding-inline-start 200ms ${cssVar.motionEaseOut};

    &[data-expand='true'] {
      padding-inline-start: 16px;
    }

    > * {
      pointer-events: auto;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  expandBtn: css`
    cursor: pointer;

    position: absolute;
    z-index: 20;
    inset-block-start: 60px;
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

    animation: workbench-expand-btn-in 120ms 200ms ${cssVar.motionEaseOut} both;

    &:hover {
      border-color: ${cssVar.colorBorder};
      color: ${cssVar.colorText};
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }

    @keyframes workbench-expand-btn-in {
      from {
        pointer-events: none;
        opacity: 0;
      }

      to {
        pointer-events: auto;
        opacity: 1;
      }
    }
  `,
}));

export const HeaderBrand = memo(() => {
  const { expand } = useReportPanelExpand();
  return <WorkbenchBrandCluster collapsed={expand} />;
});

HeaderBrand.displayName = 'HeaderBrand';

const WorkspaceSidebar = memo(() => {
  const { t } = useTranslation('verify');
  const panel = useReportPanelExpand();

  return (
    <>
      <div className={styles.brandOverlay} data-expand={panel.expand}>
        <WorkbenchBrandLink divider={false} />
      </div>
      <AcceptanceListPanel {...panel} headerLeading={<WorkbenchBrandSlot />} />
      {!panel.expand && (
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
    </>
  );
});

WorkspaceSidebar.displayName = 'WorkspaceSidebar';

export default WorkspaceSidebar;
