import {
  Activity,
  AppWindow,
  ArrowUpDown,
  Bot,
  Cpu,
  Flag,
  Gauge,
  Gpu,
  GraduationCap,
  Languages,
  LayoutGrid,
  MemoryStick,
  RotateCw,
  Route,
  Ruler,
  ScanEye,
  Terminal,
} from 'lucide-react';

import { isDesktop } from '@/const/version';
import FlagOverrideBadge from '@/features/DevFeatureFlagPanel/Badge';
import { localeOptions } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import type { LocaleMode } from '@/types/locale';

import { triggerOpenDevtools, triggerResetOnboarding } from './actions';
import { type DevDockItem, registerDevDockItems } from './registry';
import { useDevDockStore } from './store';

const subscribeDevDock = (listener: () => void) => useDevDockStore.subscribe(listener);
const subscribeGlobal = (listener: () => void) => useGlobalStore.subscribe(listener);

export const registerBuiltinDevDockItems = () => {
  const items: DevDockItem[] = [
    {
      defaultPinned: true,
      icon: Bot,
      id: 'agent-mock',
      label: 'Agent Mock',
      load: () => import('@/features/AgentMockDevtools'),
      type: 'panel',
    },
    {
      badge: FlagOverrideBadge,
      defaultPinned: true,
      icon: Flag,
      id: 'feature-flags',
      label: 'Feature Flags',
      load: () => import('@/features/DevFeatureFlagPanel'),
      type: 'panel',
    },
    {
      defaultPinned: true,
      icon: LayoutGrid,
      id: 'render-gallery',
      label: 'Render Gallery',
      load: () => import('@/features/DevPanel/RenderGallery'),
      type: 'panel',
    },
    {
      defaultPinned: true,
      icon: Route,
      id: 'route-path',
      label: 'Route Path',
      load: () => import('./widgets/RoutePathWidget'),
      slot: 'center',
      type: 'readout',
    },
    {
      defaultPinned: true,
      icon: Gauge,
      id: 'fps',
      label: 'FPS',
      load: () => import('./widgets/FpsWidget'),
      slot: 'right',
      type: 'readout',
    },
    {
      defaultPinned: true,
      icon: Activity,
      id: 'cls',
      label: 'CLS',
      load: () => import('./widgets/ClsWidget'),
      slot: 'right',
      type: 'readout',
    },
    {
      defaultPinned: true,
      icon: MemoryStick,
      id: 'memory',
      label: 'Memory',
      load: () => import('./widgets/MemoryWidget'),
      slot: 'right',
      type: 'readout',
    },
    isDesktop
      ? {
          defaultPinned: true,
          icon: Cpu,
          id: 'cpu-usage',
          label: 'CPU',
          load: () => import('./widgets/CpuUsageWidget'),
          slot: 'right',
          type: 'readout',
        }
      : {
          defaultPinned: true,
          icon: Cpu,
          id: 'cpu-pressure',
          label: 'CPU',
          load: () => import('./widgets/CpuPressureWidget'),
          slot: 'right',
          type: 'readout',
        },
    {
      getChecked: () => useDevDockStore.getState().mesurer,
      icon: Ruler,
      id: 'mesurer',
      label: 'Mesurer',
      onToggle: (checked) => useDevDockStore.getState().setMesurer(checked),
      subscribe: subscribeDevDock,
      type: 'toggle',
    },
    {
      getChecked: () => useDevDockStore.getState().reactScan,
      icon: ScanEye,
      id: 'react-scan',
      label: 'React Scan',
      onToggle: (checked) => useDevDockStore.getState().setReactScan(checked),
      subscribe: subscribeDevDock,
      type: 'toggle',
    },
    {
      getChecked: () => useDevDockStore.getState().scrollDebug,
      icon: ArrowUpDown,
      id: 'scroll-debug',
      label: 'Scroll debug',
      onToggle: (checked) => useDevDockStore.getState().setScrollDebug(checked),
      subscribe: subscribeDevDock,
      type: 'toggle',
    },
    {
      icon: RotateCw,
      id: 'reload',
      label: 'Reload',
      onTrigger: () => window.location.reload(),
      type: 'action',
    },
    {
      icon: GraduationCap,
      id: 'reset-onboarding',
      label: 'Reset Onboarding',
      onTrigger: triggerResetOnboarding,
      type: 'action',
    },
    {
      getOptions: () => [
        { label: 'auto · Follow system', value: 'auto' },
        // Dev tool — the locale code is what you actually want to read here, the
        // native name is only there to tell the CJK variants apart at a glance.
        ...localeOptions.map((item) => ({
          label: `${item.value} · ${item.label}`,
          value: item.value,
        })),
      ],
      getValue: () => globalGeneralSelectors.language(useGlobalStore.getState()),
      icon: Languages,
      id: 'locale',
      label: 'Locale',
      onSelect: (value) => useGlobalStore.getState().switchLocale(value as LocaleMode),
      subscribe: subscribeGlobal,
      type: 'select',
    },
  ];

  if (isDesktop) {
    items.push(
      {
        defaultPinned: true,
        icon: Gpu,
        id: 'gpu-process',
        label: 'GPU proc',
        load: () => import('./widgets/GpuProcessWidget'),
        slot: 'right',
        type: 'readout',
      },
      {
        icon: Gpu,
        id: 'gpu-status',
        label: 'GPU Status',
        load: () => import('@/features/DevPanel/GpuStatus'),
        type: 'panel',
      },
      {
        defaultPinned: true,
        icon: AppWindow,
        id: 'tab-routers-count',
        label: 'Live Tab Routers',
        load: () => import('./widgets/TabRoutersWidget'),
        slot: 'right',
        type: 'readout',
      },
      {
        defaultPinned: true,
        icon: AppWindow,
        id: 'tab-routers',
        label: 'Tab Routers',
        load: () => import('@/features/DevPanel/TabRouters'),
        type: 'panel',
      },
      {
        icon: Terminal,
        id: 'open-devtools',
        label: 'Open DevTools',
        onTrigger: triggerOpenDevtools,
        type: 'action',
      },
    );
  }

  registerDevDockItems(items);
};
