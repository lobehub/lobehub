import { LayersIcon } from 'lucide-react';

import { routeMeta } from '@/spa/router/routeMeta';

/** Tab/route meta for the Fleet view — shown as "Observation Mode". */
export const fleetRouteMeta = routeMeta({
  icon: LayersIcon,
  titleKey: 'navigation.observation',
});
