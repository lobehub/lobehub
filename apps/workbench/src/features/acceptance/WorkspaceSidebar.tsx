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

// AcceptanceRow calls dayjs().fromNow(); the main app extends this plugin in
// src/initialize.ts, which workbench never runs.
dayjs.extend(relativeTime);

const styles = createStaticStyles(({ css }) => ({
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

    &:hover {
      border-color: ${cssVar.colorBorder};
      color: ${cssVar.colorText};
    }
  `,
}));

const WorkspaceSidebar = memo(() => {
  const { t } = useTranslation('verify');
  const panel = useReportPanelExpand();

  return (
    <>
      <AcceptanceListPanel {...panel} />
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
