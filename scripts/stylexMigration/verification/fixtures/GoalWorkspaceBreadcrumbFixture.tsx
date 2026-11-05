import { MemoryRouter } from 'react-router';
import { GoalWorkspaceBreadcrumb } from 'verification:component';

import { FixtureI18n } from './FixtureI18n';

const titles: Record<string, string> = {
  long: 'Raise the weekly retention of new workspaces past forty percent before the next planning cycle',
};

export const Fixture = ({ variant }: { variant: string }) => (
  <FixtureI18n>
    <MemoryRouter>
      <div
        style={{ display: 'flex', minWidth: 0, width: variant.startsWith('narrow') ? 240 : 640 }}
      >
        <GoalWorkspaceBreadcrumb title={titles[variant] ?? 'Ship the onboarding checklist'} />
      </div>
    </MemoryRouter>
  </FixtureI18n>
);
