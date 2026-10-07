import {
  Activity,
  Award,
  BarChart3,
  Gauge,
  LoaderPinwheel,
  type LucideIcon,
  Server,
  Target,
  TrendingUp,
  Trophy,
  Volleyball,
  Zap,
} from 'lucide-react';

const SYSTEM_ICONS: LucideIcon[] = [
  LoaderPinwheel,
  Volleyball,
  Server,
  Target,
  Award,
  Trophy,
  Activity,
  BarChart3,
  TrendingUp,
  Gauge,
  Zap,
];

/** Stable per-benchmark glyph, so the same benchmark looks the same in the sidebar and page. */
export const getBenchmarkIcon = (id?: string): LucideIcon => {
  if (!id) return Server;
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return SYSTEM_ICONS[hash % SYSTEM_ICONS.length];
};
