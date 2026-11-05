// oxlint-disable-next-line stylex-migration/no-plain-css -- the fixture stands in for the NavPanelDraggable root that owns this stylesheet
import '@/features/NavPanel/components/NavPanelDraggable.css';

import { SideBarHeaderLayout } from 'verification:component';

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
        <div data-nav-panel-draggable className="lobe-nav-panel-draggable-4efd33c1-panel">
          {header}
        </div>
      )}
    </FixtureI18n>
  );
};
