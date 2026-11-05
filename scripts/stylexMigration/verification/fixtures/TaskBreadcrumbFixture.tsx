import { MemoryRouter } from 'react-router';
import { TaskBreadcrumb } from 'verification:component';

import { FixtureI18n } from './FixtureI18n';

export const Fixture = ({ variant }: { variant: string }) => (
  <FixtureI18n>
    <MemoryRouter>
      <div
        style={{ display: 'flex', minWidth: 0, width: variant.startsWith('narrow') ? 280 : 720 }}
      >
        <TaskBreadcrumb taskId={variant.startsWith('root') ? undefined : 'T-3'} />
      </div>
    </MemoryRouter>
  </FixtureI18n>
);
