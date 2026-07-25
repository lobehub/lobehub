import { Bot, Flag, LayoutGrid } from 'lucide-react';

import { isDesktop } from '@/const/version';
import FlagOverrideBadge from '@/features/DevFeatureFlagPanel/Badge';

import { type DevDockItem, registerDevDockItems } from './registry';

export const registerBuiltinDevDockItems = () => {
  const items: DevDockItem[] = [
    {
      id: 'route-path',
      load: () => import('./widgets/RoutePathWidget'),
      placement: 'left',
      type: 'widget',
    },
    {
      icon: Bot,
      id: 'agent-mock',
      load: () => import('@/features/AgentMockDevtools'),
      title: 'Agent Mock',
      type: 'panel',
    },
    {
      badge: FlagOverrideBadge,
      icon: Flag,
      id: 'feature-flags',
      load: () => import('@/features/DevFeatureFlagPanel'),
      title: 'Feature Flags',
      type: 'panel',
    },
    {
      icon: LayoutGrid,
      id: 'render-gallery',
      load: () => import('@/features/DevPanel/RenderGallery'),
      title: 'Render Gallery',
      type: 'panel',
    },
    {
      id: 'scroll-debug',
      load: () => import('./widgets/ScrollDebugWidget'),
      placement: 'right',
      type: 'widget',
    },
    {
      id: 'react-scan',
      load: () => import('./widgets/ReactScanWidget'),
      placement: 'right',
      type: 'widget',
    },
    {
      id: 'reload',
      load: () => import('./widgets/ReloadWidget'),
      placement: 'right',
      type: 'widget',
    },
    {
      id: 'fps',
      load: () => import('./widgets/FpsWidget'),
      placement: 'right',
      type: 'widget',
    },
    isDesktop
      ? {
          id: 'cpu-usage',
          load: () => import('./widgets/CpuUsageWidget'),
          placement: 'right',
          type: 'widget',
        }
      : {
          id: 'cpu-pressure',
          load: () => import('./widgets/CpuPressureWidget'),
          placement: 'right',
          type: 'widget',
        },
    {
      id: 'memory',
      load: () => import('./widgets/MemoryWidget'),
      placement: 'right',
      type: 'widget',
    },
  ];

  if (isDesktop) {
    items.push({
      id: 'open-devtools',
      load: () => import('./widgets/OpenDevtoolsWidget'),
      placement: 'right',
      type: 'widget',
    });
  }

  registerDevDockItems(items);
};
