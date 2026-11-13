import { Tooltip } from '@lobehub/ui';
import type { ReactNode } from 'react';

/**
 * Tooltip wrapper for the manage gate. Disabled native buttons swallow hover
 * events, so the tooltip needs an enabled wrapper element to anchor on; when
 * there is no gate message, render children untouched.
 */
const ManageTooltip = ({ children, title }: { children: ReactNode; title?: string }) =>
  title ? (
    <Tooltip title={title}>
      <span style={{ display: 'inline-flex' }}>{children}</span>
    </Tooltip>
  ) : (
    children
  );

export default ManageTooltip;
