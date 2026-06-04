import { DropdownMenu } from '@lobehub/ui/base-ui';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectorToolPermission } from '@/database/schemas';
import type { ConnectorTool } from '@/store/tool/slices/connector';

import ToolPermissionRow from './ToolPermissionRow';

interface ToolPermissionGroupProps {
  label: string;
  onBatchPermission: (toolIds: string[], permission: ConnectorToolPermission) => void;
  onPermissionChange: (toolId: string, permission: ConnectorToolPermission) => void;
  tools: ConnectorTool[];
}

const ToolPermissionGroup = memo<ToolPermissionGroupProps>(
  ({ label, tools, onPermissionChange, onBatchPermission }) => {
    const { t } = useTranslation('tool');
    const [expanded, setExpanded] = useState(true);

    if (tools.length === 0) return null;

    const toolIds = tools.map((t) => t.id);

    const batchItems = [
      {
        key: 'auto',
        label: t('connector.permission.autoAll', 'Auto all'),
        onClick: () => onBatchPermission(toolIds, ConnectorToolPermission.auto),
      },
      {
        key: 'approval',
        label: t('connector.permission.approvalAll', 'Needs approval all'),
        onClick: () => onBatchPermission(toolIds, ConnectorToolPermission.needs_approval),
      },
      {
        key: 'disable',
        label: t('connector.permission.disableAll', 'Disable all'),
        onClick: () => onBatchPermission(toolIds, ConnectorToolPermission.disabled),
      },
    ];

    return (
      <div>
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            gap: 8,
            padding: '8px 0',
          }}
        >
          <div
            style={{ alignItems: 'center', cursor: 'pointer', display: 'flex', flex: 1, gap: 6 }}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
            <span style={{ fontWeight: 500 }}>{label}</span>
            <span style={{ color: 'var(--lobe-colors-neutral-500)', fontSize: 12 }}>
              {tools.length}
            </span>
          </div>

          <DropdownMenu items={batchItems}>
            <span
              style={{
                color: 'var(--lobe-colors-neutral-500)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {t('connector.permission.custom', 'Custom')} ▾
            </span>
          </DropdownMenu>
        </div>

        {expanded && (
          <div>
            {tools.map((tool) => (
              <ToolPermissionRow
                key={tool.id}
                tool={tool}
                onPermissionChange={onPermissionChange}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);

ToolPermissionGroup.displayName = 'ToolPermissionGroup';

export default ToolPermissionGroup;
