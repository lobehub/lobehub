import { SignUp } from '@clerk/nextjs';
import { notFound } from '@/libs/next/navigation';

import { enableBetterAuth, enableClerk } from '@/envs/auth';
import { metadataModule } from '@/server/metadata';
import { translation } from '@/server/translation';
import { type DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

import BetterAuthSignUpForm from './BetterAuthSignUpForm';

export const generateMetadata = async (props: DynamicLayoutProps) => {
  const locale = await RouteVariants.getLocale(props);

  if (enableClerk) {
    const { t } = await translation('clerk', locale);
    return metadataModule.generate({
      description: t('signUp.start.subtitle'),
      title: t('signUp.start.title'),
      url: '/signup',
    });
  }

  if (enableBetterAuth) {
    const { t } = await translation('auth', locale);
    return metadataModule.generate({
      description: t('betterAuth.signup.subtitle'),
      title: t('betterAuth.signup.title'),
      url: '/signup',
    });
  }

  return metadataModule.generate({
    title: 'Sign Up',
    url: '/signup',
  });
};

const Page = () => {
  if (enableClerk) {
    return <SignUp path="/signup" />;
  }

  if (enableBetterAuth) {
    return <BetterAuthSignUpForm />;
  }

  return notFound();
};

Page.displayName = 'SignUp';

export default Page;
