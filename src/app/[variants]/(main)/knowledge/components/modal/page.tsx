import { PagePropsWithId } from '@/types/next';

import ModalPageClient from './ModalPageClient';

const Page = async (props: PagePropsWithId) => {
  const params = await props.params;

  return <ModalPageClient id={params.id} />;
};

export default Page;

export const dynamic = 'force-static';
