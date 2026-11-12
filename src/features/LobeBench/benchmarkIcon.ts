import {
  Activity,
  Award,
  BarChart3,
  Gauge,
  LoaderPinwheel,
  Server,
  Target,
  TrendingUp,
  Trophy,
  Volleyball,
  Zap,
} from 'lucide-react';

/** The Evaluation Lab's benchmark icons, picked by the same id hash so a benchmark looks the same on both sides. */
const BENCHMARK_ICONS = [
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

export const getBenchmarkIcon = (id: string) => {
  const hash = [...id].reduce((acc, char) => acc + (char.codePointAt(0) ?? 0), 0);
  return BENCHMARK_ICONS[hash % BENCHMARK_ICONS.length];
};
