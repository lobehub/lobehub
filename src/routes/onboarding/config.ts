import {
  ChartNetworkIcon,
  CodeXmlIcon,
  GraduationCapIcon,
  HandCoinsIcon,
  PaintBucketIcon,
  PenIcon,
  PercentIcon,
  TargetIcon,
} from 'lucide-react';

/** Default target when the user opens `/onboarding`. Flip to `'agent'` when agent onboarding is ready to ship as the primary flow. */
export type DefaultOnboardingEntryVariant = 'agent' | 'classic';

export const DEFAULT_ONBOARDING_ENTRY_VARIANT: DefaultOnboardingEntryVariant = 'classic';

export const DEFAULT_ONBOARDING_PATH: '/onboarding/agent' | '/onboarding/classic' =
  DEFAULT_ONBOARDING_ENTRY_VARIANT === 'agent' ? '/onboarding/agent' : '/onboarding/classic';

/**
 * Predefined interest areas with icons and translation keys.
 * Use with `t('interests.area.${key}')` from 'onboarding' namespace.
 */
export const INTEREST_AREAS = [
  { icon: PenIcon, key: 'writing' },
  { icon: CodeXmlIcon, key: 'coding' },
  { icon: PaintBucketIcon, key: 'design' },
  { icon: GraduationCapIcon, key: 'education' },
  { icon: ChartNetworkIcon, key: 'business' },
  { icon: PercentIcon, key: 'marketing' },
  { icon: TargetIcon, key: 'product' },
  { icon: HandCoinsIcon, key: 'sales' },
] as const;

export type InterestAreaKey = (typeof INTEREST_AREAS)[number]['key'];
