import {
  BarChart2Icon,
  BotIcon,
  BoxIcon,
  BriefcaseIcon,
  BuildingIcon,
  ClipboardListIcon,
  CodeXmlIcon,
  CogIcon,
  CpuIcon,
  DollarSignIcon,
  FileTextIcon,
  FlaskConicalIcon,
  GlobeIcon,
  HeartHandshakeIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  PackageIcon,
  SearchIcon,
  ShieldIcon,
  ShoppingCartIcon,
  StarIcon,
  TruckIcon,
  UsersIcon,
  WrenchIcon,
} from 'lucide-react';

/**
 * Company departments (single-select).
 * Use with `t('interests.area.${key}')` from 'onboarding' namespace.
 */
export const INTEREST_AREAS = [
  { icon: CpuIcon, key: 'it' },
  { icon: CodeXmlIcon, key: 'rd' },
  { icon: LayoutDashboardIcon, key: 'product' },
  { icon: BotIcon, key: 'robot' },
  { icon: DollarSignIcon, key: 'finance' },
  { icon: CogIcon, key: 'manufacturing' },
  { icon: ClipboardListIcon, key: 'quality' },
  { icon: ShoppingCartIcon, key: 'domestic_sales' },
  { icon: GlobeIcon, key: 'intl_sales' },
  { icon: StarIcon, key: 'overseas_brand' },
  { icon: PackageIcon, key: 'overseas_warehouse' },
  { icon: UsersIcon, key: 'hr' },
  { icon: BuildingIcon, key: 'admin' },
  { icon: TruckIcon, key: 'supply_chain' },
  { icon: BoxIcon, key: 'supply_4' },
  { icon: SearchIcon, key: 'odm' },
  { icon: BriefcaseIcon, key: 'ceo_office' },
  { icon: LandmarkIcon, key: 'president_office' },
  { icon: WrenchIcon, key: 'automation' },
  { icon: FlaskConicalIcon, key: 'smart_research' },
  { icon: HeartHandshakeIcon, key: 'infrastructure' },
  { icon: FileTextIcon, key: 'secretary' },
  { icon: BarChart2Icon, key: 'creative' },
  { icon: ShieldIcon, key: 'risk_control' },
] as const;

export type InterestAreaKey = (typeof INTEREST_AREAS)[number]['key'];
