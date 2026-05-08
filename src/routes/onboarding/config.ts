import { AGENT_ONBOARDING_ENABLED } from '@lobechat/business-const';
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

export const ONBOARDING_AGENT_PATH = '/onboarding/agent';
export const ONBOARDING_CLASSIC_PATH = '/onboarding/classic';

export type OnboardingBranchPath = typeof ONBOARDING_AGENT_PATH | typeof ONBOARDING_CLASSIC_PATH;

interface DeriveOnboardingBranchInput {
  enableAgentOnboarding: boolean;
  isDesktop: boolean;
}

/**
 * Decide which branch the user enters after the shared-prefix steps complete.
 * `AGENT_ONBOARDING_ENABLED` is the build-time master switch — when it is off,
 * the agent flow is unreachable regardless of the runtime feature flag.
 * Desktop and disabled-flag users also land on the classic flow; otherwise
 * the agent conversational flow is the default.
 */
export const deriveOnboardingBranchPath = ({
  enableAgentOnboarding,
  isDesktop,
}: DeriveOnboardingBranchInput): OnboardingBranchPath => {
  if (!AGENT_ONBOARDING_ENABLED || isDesktop || !enableAgentOnboarding) {
    return ONBOARDING_CLASSIC_PATH;
  }
  return ONBOARDING_AGENT_PATH;
};

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
