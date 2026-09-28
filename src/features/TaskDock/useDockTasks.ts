import { useMemo } from 'react';

import { useBusinessDockTasks } from '@/business/client/features/DockTasks';

import { useFileUploadDockTasks } from './providers/useFileUploadDockTasks';
import type { DockTask } from './type';

export const useDockTasks = (): DockTask[] => {
  const business = useBusinessDockTasks();
  const uploads = useFileUploadDockTasks();

  return useMemo(() => [...business, ...uploads], [business, uploads]);
};
