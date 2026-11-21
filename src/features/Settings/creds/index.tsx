'use client';

import { Flexbox } from '@lobehub/ui';

import CredsList from './features/CredsList';

interface PageProps {
  mobile?: boolean;
}

/**
 * The personal vault (`/settings/credential`). The shared settings header
 * shows its title; the list carries its own toolbar — category tabs, search
 * and the create menu — in one row above the items.
 */
const Page = ({ mobile }: PageProps) => {
  if (mobile)
    return (
      <Flexbox padding={16}>
        <CredsList mobile />
      </Flexbox>
    );

  return <CredsList />;
};

Page.displayName = 'CredsSetting';

export default Page;
