import { Command } from 'cmdk';
import { CommandMenuTheme } from 'verification:component';

import CommandInput from '@/features/CommandMenu/components/CommandInput';
import { fallback } from '@/features/CommandMenu/styles';

const noop = () => {};

export const Fixture = () => (
  <Command className={fallback.commandRoot} style={{ width: 640 }}>
    <CommandInput onInputChange={noop} onTypeFilterChange={noop} />
    <Command.Group heading="Theme">
      <CommandMenuTheme />
    </Command.Group>
  </Command>
);
