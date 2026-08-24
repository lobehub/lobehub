import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

import ShareLoading from '../../src/shell/ShareLoading';
import { buildAppExitUrl } from '../lib/appExit';
import { cloudflareContext } from '../lib/cloudflareContext';

export const loader = ({ context, request }: LoaderFunctionArgs) => {
  const appHome = context.get(cloudflareContext).env.SHARE_APP_HOME as string | undefined;

  return redirect(buildAppExitUrl(request.url, appHome));
};

export default function ExitShare() {
  return <ShareLoading />;
}
