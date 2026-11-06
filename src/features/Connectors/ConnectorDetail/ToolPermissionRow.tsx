import { Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BanIcon, CheckIcon, HandIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectorToolPermission } from '@/database/schemas';
import type { ConnectorTool } from '@/store/tool/slices/connector';

const styles = stylex.create({
  btn: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorText },
    transition: 'color 0.15s,\n      background 0.15s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  btnActive: {
    color: { 'default': cssVar.colorPrimary, ':hover': cssVar.colorPrimary },
    backgroundColor: { 'default': cssVar.colorPrimaryBg, ':hover': cssVar.colorPrimaryBgHover },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  description: {
    overflow: 'hidden',
    fontSize: '11px',
    lineHeight: 1.4,
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nameCell: { overflow: 'hidden', flex: '1', minWidth: '0' },
  row: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'solid', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  toolName: {
    overflow: 'hidden',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '13px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface ToolPermissionRowProps {
  /** Read-only mode — the caller lacks the manage permission for this connector. */
  disabled?: boolean;
  onPermissionChange: (toolId: string, permission: ConnectorToolPermission) => void;
  tool: ConnectorTool;
}

const ToolPermissionRow = memo<ToolPermissionRowProps>(({ disabled, tool, onPermissionChange }) => {
  const { t } = useTranslation('tool');
  const btnClass = (permission: ConnectorToolPermission) =>
    tool.permission === permission
      ? stylex.props(styles.btn, styles.btnActive).className
      : stylex.props(styles.btn).className;

  const handleChange = (permission: ConnectorToolPermission) => {
    if (disabled) return;
    onPermissionChange(tool.id, permission);
  };

  return (
    <div {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.nameCell)}>
        <div {...stylex.props(styles.toolName)}>{tool.toolName}</div>
        {tool.description && (
          <Tooltip mouseEnterDelay={0.5} title={tool.description}>
            <div {...stylex.props(styles.description)}>{tool.description}</div>
          </Tooltip>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexShrink: 0,
          gap: 2,
          ...(disabled && { cursor: 'not-allowed', opacity: 0.45 }),
        }}
      >
        <div
          className={btnClass(ConnectorToolPermission.auto)}
          style={disabled ? { pointerEvents: 'none' } : undefined}
          title={t('connector.permission.auto')}
          onClick={() => handleChange(ConnectorToolPermission.auto)}
        >
          <CheckIcon size={15} />
        </div>
        <div
          className={btnClass(ConnectorToolPermission.needs_approval)}
          style={disabled ? { pointerEvents: 'none' } : undefined}
          title={t('connector.permission.needsApproval')}
          onClick={() => handleChange(ConnectorToolPermission.needs_approval)}
        >
          <HandIcon size={15} />
        </div>
        <div
          className={btnClass(ConnectorToolPermission.disabled)}
          style={disabled ? { pointerEvents: 'none' } : undefined}
          title={t('connector.permission.disabled')}
          onClick={() => handleChange(ConnectorToolPermission.disabled)}
        >
          <BanIcon size={15} />
        </div>
      </div>
    </div>
  );
});

ToolPermissionRow.displayName = 'ToolPermissionRow';

export default ToolPermissionRow;
