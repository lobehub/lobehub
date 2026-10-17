import { redirect } from 'react-router';

import { ACCEPTANCE_LIST_PATH } from '@/features/Acceptance/roundLink';

import WorkbenchLoading from '../../src/shell/WorkbenchLoading';

// The standalone report list is gone; reports live on Acceptance.
export const loader = () => redirect(ACCEPTANCE_LIST_PATH);

export default function VerifyListRedirect() {
  return <WorkbenchLoading />;
}
