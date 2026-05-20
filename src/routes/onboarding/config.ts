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

export type { OnboardingBranchPath } from './branch';
export {
  deriveOnboardingBranchPath,
  ONBOARDING_AGENT_PATH,
  ONBOARDING_CLASSIC_PATH,
} from './branch';

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
