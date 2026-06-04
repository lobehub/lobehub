import { createStaticStyles, cssVar } from 'antd-style';
import { BanIcon, CheckCircleIcon, HandIcon } from 'lucide-react';
import { memo } from 'react';

import { ConnectorToolPermission } from '@/database/schemas';
import type { ConnectorTool } from '@/store/tool/slices/connector';

const useStyles = createStaticStyles(({ css }) => ({
  btn: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: 6px;

    color: ${cssVar('colorTextTertiary')};

    transition: all 0.15s;

    &:hover {
      background: ${cssVar('colorFillTertiary')};
    }
  `,
  btnActive: css`
    color: ${cssVar('colorPrimary')};
    background: ${cssVar('colorPrimaryBg')};

    &:hover {
      background: ${cssVar('colorPrimaryBg')};
    }
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 0;
    border-block-end: 1px solid ${cssVar('colorBorderSecondary')};

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
  const { styles, cx } = useStyles();

  return (
    <div className={styles.row}>
      <span style={{ flex: 1, fontSize: 13 }}>{tool.toolName}</span>
      <div style={{ display: 'flex', gap: 2 }}>
        <div
          className={cx(
            styles.btn,
            tool.permission === ConnectorToolPermission.auto && styles.btnActive,
          )}
          title="Auto — AI calls directly"
          onClick={() => onPermissionChange(tool.id, ConnectorToolPermission.auto)}
        >
          <CheckCircleIcon size={14} />
        </div>
        <div
          className={cx(
            styles.btn,
            tool.permission === ConnectorToolPermission.needs_approval && styles.btnActive,
          )}
          title="Needs approval"
          onClick={() => onPermissionChange(tool.id, ConnectorToolPermission.needs_approval)}
        >
          <HandIcon size={14} />
        </div>
        <div
          className={cx(
            styles.btn,
            tool.permission === ConnectorToolPermission.disabled && styles.btnActive,
          )}
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
