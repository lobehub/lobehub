import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MonitorIcon } from 'lucide-react';

import { getExecutionDeviceLabel } from './executionDeviceLabel';

const styles = stylex.create({
  label: {
    overflow: 'hidden',
    minWidth: '0',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  root: {
    display: 'inline-flex',
    flexShrink: 0,
    gap: '4px',
    alignItems: 'center',
    maxWidth: '180px',
    fontSize: '12px',
    color: cssVar.colorTextDescription,
  },
});

interface ExecutionDeviceTagProps {
  args?: unknown;
  identifier: string;
  pluginState?: unknown;
}

/** Names the device a Local System call picked; see `getExecutionDeviceLabel`. */
const ExecutionDeviceTag = (props: ExecutionDeviceTagProps) => {
  const device = getExecutionDeviceLabel(props);
  if (!device) return null;

  return (
    <span {...stylex.props(styles.root)} title={device.title}>
      <MonitorIcon size={12} />
      <span {...stylex.props(styles.label)}>{device.label}</span>
    </span>
  );
};

export default ExecutionDeviceTag;
