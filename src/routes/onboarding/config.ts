import {
  BabyIcon,
  CameraIcon,
  ChartNetworkIcon,
  CodeXmlIcon,
  CompassIcon,
  GraduationCapIcon,
  HandCoinsIcon,
  HeartIcon,
  HomeIcon,
  LineChartIcon,
  PaintBucketIcon,
  PenIcon,
  PercentIcon,
  ScaleIcon,
  SettingsIcon,
  TargetIcon,
  UsersIcon,
} from 'lucide-react';

/** Default target when the user opens `/onboarding`. Flip to `'agent'` when agent onboarding is ready to ship as the primary flow. */
export type DefaultOnboardingEntryVariant = 'agent' | 'classic';
export const DEFAULT_ONBOARDING_ENTRY_VARIANT: DefaultOnboardingEntryVariant = 'classic';

const resolveDefaultOnboardingPath = (variant: DefaultOnboardingEntryVariant) =>
  variant === 'agent' ? '/onboarding/agent' : '/onboarding/classic';

export const DEFAULT_ONBOARDING_PATH: '/onboarding/agent' | '/onboarding/classic' =
  resolveDefaultOnboardingPath(DEFAULT_ONBOARDING_ENTRY_VARIANT);

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
  { icon: SettingsIcon, key: 'operations' },
  { icon: UsersIcon, key: 'hr' },
  { icon: ScaleIcon, key: 'finance-legal' },
  { icon: CameraIcon, key: 'creator' },
  { icon: LineChartIcon, key: 'investing' },
  { icon: BabyIcon, key: 'parenting' },
  { icon: HeartIcon, key: 'health' },
  { icon: CompassIcon, key: 'hobbies' },
  { icon: HomeIcon, key: 'personal' },
] as const;

export type InterestAreaKey = (typeof INTEREST_AREAS)[number]['key'];
