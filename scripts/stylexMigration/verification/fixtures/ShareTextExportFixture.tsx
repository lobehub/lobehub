import { ShareTextExport } from 'verification:component';

import { FixtureI18n } from './FixtureI18n';

export const Fixture = () => (
  <FixtureI18n>
    <div style={{ display: 'flex', height: 480 }}>
      <ShareTextExport />
    </div>
  </FixtureI18n>
);
