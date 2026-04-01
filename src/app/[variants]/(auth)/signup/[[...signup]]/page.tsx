import { redirect } from 'next/navigation';

import { authEnv } from '@/envs/auth';
import { isPhoneAuthEnabled, smsEnv } from '@/envs/sms';
import { metadataModule } from '@/server/metadata';
import { translation } from '@/server/translation';
import { type DynamicLayoutProps } from '@/types/next';
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
  const enablePhoneSignup = isPhoneAuthEnabled && smsEnv.AUTO_REGISTER_ON_PHONE_LOGIN;

  if (!enablePhoneSignup) {
    if (authEnv.AUTH_DISABLE_EMAIL_PASSWORD && isPhoneAuthEnabled) {
      redirect('/signin?mode=phone');
    }

    redirect('/signin');
  }

  return <BetterAuthSignUpForm />;
};

export default Page;
