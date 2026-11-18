import { SidebarGroupItem } from 'verification:component';

import { FixtureI18n } from './FixtureI18n';

export const Fixture = ({ variant }: { variant: string }) => (
  <FixtureI18n>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <SidebarGroupItem
        disabled
        id="fixture-group"
        name={
          variant === 'long'
            ? 'A long sidebar folder title to exercise overflow at narrow widths'
            : 'Folder'
        }
      />
    </div>
  </FixtureI18n>
);
