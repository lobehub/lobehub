import { enableBetterAuth } from '@/envs/auth';
import { notFound } from '@/libs/next/navigation';
import { metadataModule } from '@/server/metadata';
import { translation } from '@/server/translation';
import { type DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

import BetterAuthSignUpForm from './BetterAuthSignUpForm';

export const generateMetadata = async (props: DynamicLayoutProps) => {
  const locale = await RouteVariants.getLocale(props);

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
  if (enableBetterAuth) {
    return <BetterAuthSignUpForm />;
  }

  return notFound();
};

export default Page;
