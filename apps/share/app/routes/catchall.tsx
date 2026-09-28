import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

import ShareLoading from '../../src/shell/ShareLoading';
import { cloudflareContext } from '../lib/cloudflareContext';

export const loader = ({ context }: LoaderFunctionArgs) => {
  const appHome = context.get(cloudflareContext).env.SHARE_APP_HOME as string | undefined;

  return redirect(appHome || 'https://lobehub.com');
};

export default function ExitShare() {
  return <ShareLoading />;
}
