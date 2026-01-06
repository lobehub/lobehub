import { SignIn } from '@clerk/nextjs';
import { BRANDING_NAME } from '@lobechat/business-const';
import { notFound } from 'next/navigation';

import { enableClerk } from '@/envs/auth';
import { metadataModule } from '@/server/metadata';
import { translation } from '@/server/translation';
import { type DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

export const generateMetadata = async (props: DynamicLayoutProps) => {
  const locale = await RouteVariants.getLocale(props);
  const { t } = await translation('clerk', locale);
  return metadataModule.generate({
    description: t('signIn.start.subtitle'),
    title: t('signIn.start.title', { applicationName: BRANDING_NAME }),
    url: '/login',
  });
};

const Page = () => {
  if (!enableClerk) return notFound();

  return <SignIn path="/login" />;
};

Page.displayName = 'Login';

export default Page;
