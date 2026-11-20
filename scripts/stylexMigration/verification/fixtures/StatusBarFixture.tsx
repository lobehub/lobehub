import { StatusBar } from 'verification:component';

import { FixtureI18n } from './FixtureI18n';

export const Fixture = ({ variant }: { variant: string }) => (
  <FixtureI18n>
    <StatusBar
      cursor={{ column: 4, line: 12, selectionLength: 8 }}
      indent={{ size: variant === 'tabs' ? 4 : 2, useTabs: variant === 'tabs' }}
      languageLabel="TypeScript"
      lineWrapping={variant === 'wrap'}
      readOnly={variant === 'readonly'}
      onLineWrappingChange={() => {}}
    />
  </FixtureI18n>
);
