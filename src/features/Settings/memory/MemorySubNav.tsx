'use client';

import { Flexbox } from '@lobehub/ui';
import {
  BrainCircuitIcon,
  BubblesIcon,
  CalendarClockIcon,
  HeartPulseIcon,
  ScaleIcon,
  SignatureIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import NavItem, { type NavItemProps } from '@/features/NavPanel/components/NavItem';
import { useSelfLearningSurface } from '@/features/SelfLearning/SurfaceGate/useSelfLearningSurface';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { isModifierClick } from '@/utils/navigation';

interface MemorySection {
  icon: NavItemProps['icon'];
  key: string;
  titleKey:
    | 'tab.activities'
    | 'tab.contexts'
    | 'tab.identities'
    | 'tab.overview'
    | 'tab.preferences'
    | 'tab.rules';
}

const OVERVIEW: MemorySection = {
  icon: BrainCircuitIcon,
  key: 'overview',
  titleKey: 'tab.overview',
};
const RULES: MemorySection = { icon: ScaleIcon, key: 'rules', titleKey: 'tab.rules' };
const RECORDS: MemorySection[] = [
  { icon: SignatureIcon, key: 'identities', titleKey: 'tab.identities' },
  { icon: HeartPulseIcon, key: 'preferences', titleKey: 'tab.preferences' },
  { icon: BubblesIcon, key: 'contexts', titleKey: 'tab.contexts' },
  { icon: CalendarClockIcon, key: 'activities', titleKey: 'tab.activities' },
];

interface MemorySubNavProps {
  activeSection?: string;
}

/** The memory pages, listed under the Memory row of the settings sidebar while it is open. */
const MemorySubNav = ({ activeSection }: MemorySubNavProps) => {
  const { t } = useTranslation('memory');
  const navigate = useWorkspaceAwareNavigate();
  // Rules are limited to the self-iteration rollout and Labs opt-ins.
  const { enabled: enableSelfLearning } = useSelfLearningSurface();
  const sections = [OVERVIEW, ...(enableSelfLearning ? [RULES] : []), ...RECORDS];

  return (
    <Flexbox gap={1} style={{ paddingInlineStart: 16 }}>
      {sections.map(({ icon, key, titleKey }) => {
        const url = `/settings/memory/${key}`;
        return (
          <Link
            key={key}
            to={url}
            onClick={(e) => {
              if (isModifierClick(e)) return;
              e.preventDefault();
              navigate(url);
            }}
          >
            <NavItem active={activeSection === key} icon={icon} title={t(titleKey)} />
          </Link>
        );
      })}
    </Flexbox>
  );
};

export default MemorySubNav;
