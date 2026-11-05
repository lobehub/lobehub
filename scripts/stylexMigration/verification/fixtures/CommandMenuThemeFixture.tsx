// oxlint-disable-next-line stylex-migration/no-plain-css -- replays the stylesheet the real CommandMenu root loads, so each snapshot gets its own cmdk cascade
import '@/features/CommandMenu/styles.css';

import { Command } from 'cmdk';
import { CommandMenuTheme } from 'verification:component';

import CommandInput from '@/features/CommandMenu/components/CommandInput';

const noop = () => {};

export const Fixture = () => (
  <Command className="lobe-command-menu-48defd20-root" style={{ width: 640 }}>
    <CommandInput onInputChange={noop} onTypeFilterChange={noop} />
    <Command.Group heading="Theme">
      <CommandMenuTheme />
    </Command.Group>
  </Command>
);
