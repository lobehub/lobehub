'use client';

import { memo } from 'react';

import AppShellSkeleton from './AppShellSkeleton';
import { useBootShell } from './useBootShell';

export const BOOT_SHELL_ID = 'boot-shell';

const BootShell = memo(() => {
  const phase = useBootShell();

  if (phase !== 'shell') return null;

  return <AppShellSkeleton id={BOOT_SHELL_ID} />;
});

BootShell.displayName = 'BootShell';

export default BootShell;
