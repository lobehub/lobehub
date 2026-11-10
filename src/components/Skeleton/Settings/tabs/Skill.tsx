'use client';

import { cssVar, Flexbox, Text } from '@lobehub/ui';
import { ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';

import SkeletonBar from '../../Bar';
import { SkeletonItem } from '../../NavPanel/List';
import type { SettingsTabSkeleton } from './types';

interface NavSection {
  key: string;
  rows: number;
}

const SKILL_SECTIONS: NavSection[] = [
  { key: 'skillGroup.builtinSkills', rows: 6 },
  { key: 'skillGroup.communitySkills', rows: 4 },
];

/**
 * The list column of `LeftPanel` in nav mode: a 42px head with the view title
 * and its small action buttons, then collapsible group headings over nav rows.
 * Title and headings are static copy. Also the mobile connector list.
 */
export const SkillNavListSkeleton = ({
  actions = 2,
  fullWidth,
  sections = SKILL_SECTIONS,
  titleKey = 'skillView.skills',
}: {
  actions?: number;
  fullWidth?: boolean;
  sections?: NavSection[];
  titleKey?: string;
}) => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox
      style={{
        borderInlineEnd: fullWidth ? undefined : `1px solid ${cssVar.colorBorderSecondary}`,
        minWidth: 260,
        overflow: 'hidden',
        width: fullWidth ? '100%' : 300,
      }}
    >
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        height={42}
        justify={'space-between'}
        paddingInline={16}
        style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`, flexShrink: 0 }}
      >
        <Text strong style={{ fontSize: 14 }}>
          {t(titleKey as any)}
        </Text>
        <Flexbox horizontal gap={6}>
          {Array.from({ length: actions }, (_, index) => (
            <SkeletonBar height={24} key={index} width={24} />
          ))}
        </Flexbox>
      </Flexbox>
      <Flexbox gap={2} paddingBlock={4} paddingInline={8}>
        {sections.map(({ key, rows }) => (
          <Flexbox gap={2} key={key}>
            <Flexbox
              horizontal
              align={'center'}
              gap={4}
              paddingInline={4}
              style={{
                color: cssVar.colorTextSecondary,
                fontSize: 12,
                fontWeight: 500,
                paddingBlock: '12px 4px',
              }}
            >
              <ChevronDownIcon size={10} />
              {t(key as any)}
            </Flexbox>
            {Array.from({ length: rows }, (_, index) => (
              <SkeletonItem avatarSize={20} key={index} />
            ))}
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
};

/** The detail pane opened on the first built-in skill: icon + title head over its text. */
const DetailPane = () => (
  <Flexbox flex={1} gap={24} padding={24} style={{ minWidth: 0 }}>
    <Flexbox horizontal align={'center'} gap={12}>
      <SkeletonBar height={40} radius={cssVar.borderRadius} width={40} />
      <Flexbox flex={1} gap={6}>
        <SkeletonBar height={18} width={160} />
        <SkeletonBar height={12} width={'48%'} />
      </Flexbox>
    </Flexbox>
    <Flexbox gap={12}>
      {[100, 92, 96, 64, 88, 72].map((width, index) => (
        <SkeletonBar height={14} key={index} width={`${width}%`} />
      ))}
    </Flexbox>
  </Flexbox>
);

/** Mobile shows the list full width under the mobile header. */
const Body = () => <SkillNavListSkeleton fullWidth />;

/** Desktop is a split pane under an empty navigation header, like `ToolSettings`. */
const Page = () => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    <NavHeader />
    <Flexbox horizontal flex={1} style={{ overflow: 'hidden' }}>
      <SkillNavListSkeleton />
      <DetailPane />
    </Flexbox>
  </Flexbox>
);

const SkillSkeleton: SettingsTabSkeleton = { Body, Page };

export default SkillSkeleton;
