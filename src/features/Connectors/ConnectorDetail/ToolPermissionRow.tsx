import { createStaticStyles } from 'antd-style';
import { BanIcon, CheckCircleIcon, HandIcon } from 'lucide-react';
import { memo } from 'react';

import { ConnectorToolPermission } from '@/database/schemas';
import type { ConnectorTool } from '@/store/tool/slices/connector';

const styles = createStaticStyles(({ css, cssVar }) => ({
  btn: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    transition: all 0.15s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  btnActive: css`
    color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      background: ${cssVar.colorPrimaryBg};
    }
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
}));

interface ToolPermissionRowProps {
  onPermissionChange: (toolId: string, permission: ConnectorToolPermission) => void;
  tool: ConnectorTool;
}

const ToolPermissionRow = memo<ToolPermissionRowProps>(({ tool, onPermissionChange }) => {
  const btnClass = (permission: ConnectorToolPermission) =>
    tool.permission === permission ? `${styles.btn} ${styles.btnActive}` : styles.btn;

  return (
    <div className={styles.row}>
      <span style={{ flex: 1, fontSize: 13 }}>{tool.toolName}</span>
      <div style={{ display: 'flex', gap: 2 }}>
        <div
          className={btnClass(ConnectorToolPermission.auto)}
          title="Auto — AI calls directly"
          onClick={() => onPermissionChange(tool.id, ConnectorToolPermission.auto)}
        >
          <CheckCircleIcon size={14} />
        </div>
        <div
          className={btnClass(ConnectorToolPermission.needs_approval)}
          title="Needs approval"
          onClick={() => onPermissionChange(tool.id, ConnectorToolPermission.needs_approval)}
        >
          <HandIcon size={14} />
        </div>
        <div
          className={btnClass(ConnectorToolPermission.disabled)}
          title="Disabled — hidden from AI"
          onClick={() => onPermissionChange(tool.id, ConnectorToolPermission.disabled)}
        >
          <BanIcon size={14} />
        </div>
      </div>
    </div>
  );
});

ToolPermissionRow.displayName = 'ToolPermissionRow';

export default ToolPermissionRow;
