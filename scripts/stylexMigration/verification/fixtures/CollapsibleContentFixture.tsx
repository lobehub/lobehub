import { CollapsibleContent } from 'verification:component';

import { FixtureI18n } from './FixtureI18n';

const lines = Array.from(
  { length: 20 },
  (_, index) => `Line ${index + 1}: deterministic component content.`,
);

export const Fixture = ({ variant }: { variant: string }) => (
  <FixtureI18n>
    <CollapsibleContent
      collapsed={variant !== 'expanded'}
      maxHeight={100}
      onCollapsedChange={() => {}}
    >
      {variant === 'short' ? <p>Short content</p> : lines.map((line) => <p key={line}>{line}</p>)}
    </CollapsibleContent>
  </FixtureI18n>
);
