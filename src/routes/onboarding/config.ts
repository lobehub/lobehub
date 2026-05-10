import { AGENT_ONBOARDING_ENABLED } from '@lobechat/business-const';
import type { InterestAreaKey } from '@lobechat/const';
import { INTEREST_AREA_KEYS } from '@lobechat/const';
import type { LucideIcon } from 'lucide-react';
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
const INTEREST_AREA_ICONS: Record<InterestAreaKey, LucideIcon> = {
  'business': ChartNetworkIcon,
  'coding': CodeXmlIcon,
  'creator': CameraIcon,
  'design': PaintBucketIcon,
  'education': GraduationCapIcon,
  'finance-legal': ScaleIcon,
  'health': HeartIcon,
  'hobbies': CompassIcon,
  'hr': UsersIcon,
  'investing': LineChartIcon,
  'marketing': PercentIcon,
  'operations': SettingsIcon,
  'parenting': BabyIcon,
  'personal': HomeIcon,
  'product': TargetIcon,
  'sales': HandCoinsIcon,
  'writing': PenIcon,
};

export const INTEREST_AREAS = INTEREST_AREA_KEYS.map((key) => ({
  icon: INTEREST_AREA_ICONS[key],
  key,
}));

export type { InterestAreaKey } from '@lobechat/const';
