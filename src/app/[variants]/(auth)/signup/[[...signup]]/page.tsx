import { redirect } from 'next/navigation';

import { authEnv } from '@/envs/auth';
import { metadataModule } from '@/server/metadata';
import { translation } from '@/server/translation';
import type {DynamicLayoutProps} from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

import BetterAuthSignUpForm from './BetterAuthSignUpForm';

export const generateMetadata = async (props: DynamicLayoutProps) => {
  const locale = await RouteVariants.getLocale(props);
  const { t } = await translation('auth', locale);

  return metadataModule.generate({
    description: t('betterAuth.signup.subtitle'),
    title: t('betterAuth.signup.title'),
    url: '/signup',
  });
};

const Page = () => {
  if (authEnv.AUTH_DISABLE_EMAIL_PASSWORD) {
    redirect('/signin');
  }

  return <BetterAuthSignUpForm />;
};

export default Page;
