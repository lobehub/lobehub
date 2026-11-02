import { CommandLine } from 'verification:component';

export const Fixture = ({ variant }: { variant: string }) => (
  <CommandLine
    command={
      variant === 'long'
        ? 'node ./scripts/a-long-deterministic-command-name/verify-component-styles --all-components --offline --compare-computed-properties'
        : 'node verify-styles.mjs'
    }
  />
);
