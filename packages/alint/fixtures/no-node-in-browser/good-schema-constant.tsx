// Fixture: schema constants and the hetero root entry are browser-safe.
import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';
import { Select } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import { ConnectorToolPermission } from '@/database/schemas';

interface PermissionPickerProps {
  agentType: string;
  onChange: (value: string) => void;
  value: string;
}

const PermissionPicker = memo<PermissionPickerProps>(({ agentType, onChange, value }) => (
  <Select
    aria-label={getHeterogeneousTypeLabel(agentType)}
    value={value}
    options={Object.values(ConnectorToolPermission).map((permission) => ({
      label: permission,
      value: permission,
    }))}
    onChange={onChange}
  />
));

export default PermissionPicker;
