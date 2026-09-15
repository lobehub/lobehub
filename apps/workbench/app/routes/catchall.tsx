import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

import WorkbenchLoading from '../../src/shell/WorkbenchLoading';
import { cloudflareContext } from '../lib/cloudflareContext';

export const loader = ({ context }: LoaderFunctionArgs) => {
  const appHome = context.get(cloudflareContext).env.WORKBENCH_APP_HOME as string | undefined;

  return redirect(appHome || 'https://lobehub.com');
};

export default function ExitWorkbench() {
  return <WorkbenchLoading />;
}
