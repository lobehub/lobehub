import { useDensity } from '@/styles/density';

const HOME_SPACING = {
  compact: { blockGap: 24, mainGap: 16, minimalStackGap: 16 },
  loose: { blockGap: 32, mainGap: 24, minimalStackGap: 24 },
} as const;

export const useHomeSpacing = () => HOME_SPACING[useDensity().density];
