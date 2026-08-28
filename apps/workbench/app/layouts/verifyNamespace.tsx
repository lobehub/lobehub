import { Outlet } from 'react-router';

import { WorkbenchNamespace } from '../../src/shell';

export default function VerifyNamespace() {
  return (
    <WorkbenchNamespace namespace="verify">
      <Outlet />
    </WorkbenchNamespace>
  );
}
