import { SideBarHeaderLayout } from 'verification:component';

import { fallback } from '@/features/NavPanel/components/style';

import { FixtureI18n } from './FixtureI18n';

const breadcrumb = [{ href: '/agents', title: 'Agents' }, { title: 'Current page' }];

export const Fixture = ({ variant }: { variant: string }) => {
  const header = variant.startsWith('back') ? (
    <SideBarHeaderLayout left="Sidebar title" />
  ) : (
    <SideBarHeaderLayout breadcrumb={breadcrumb} />
  );
  return (
    <FixtureI18n>
      {variant.endsWith('outside') ? (
        header
      ) : (
        <div data-nav-panel-draggable className={fallback.panel}>
          {header}
        </div>
      )}
    </FixtureI18n>
  );
};
