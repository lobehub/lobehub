'use client';

import { Center, cssVar, Flexbox } from '@lobehub/ui';

import SkeletonBar from './Bar';

export interface AgentProfileNavSkeletonProps {
  /** Number of `ActionIcon` placeholders on the right (36px hit box, 20px glyph), e.g. Channel's docs / "…" menu. */
  actions?: number;
  /** Extra breadcrumb segments after the agent name (e.g. `Channels › Discord`). */
  breadcrumbItems?: number;
  /** Whether the centred profile tab switcher is drawn (hidden on nested detail pages). */
  tabs?: boolean;
}

/**
 * `NavHeader` of the agent profile group (Profile / Channels / Statistics /
 * Share): a 44px bar with padding 8, the `AgentBreadcrumb` text (no avatar)
 * offset by the extra 8px `paddingInlineStart`, the small `AgentProfileTabs`
 * Segmented centred on the header midpoint (`AGENT_PROFILE_TABS_CENTER_STYLE`,
 * measured 244×34), and optional right-side action icons.
 */
const AgentProfileNavSkeleton = ({
  actions = 0,
  breadcrumbItems = 0,
  tabs = true,
}: AgentProfileNavSkeletonProps) => (
  <Flexbox
    horizontal
    align={'center'}
    flex={'none'}
    height={44}
    justify={'space-between'}
    padding={8}
    style={{ position: 'relative' }}
  >
    <Flexbox horizontal align={'center'} gap={8} style={{ paddingInlineStart: 8 }}>
      <SkeletonBar height={14} width={72} />
      {Array.from({ length: breadcrumbItems }).map((_, index) => (
        <Flexbox horizontal align={'center'} gap={8} key={index}>
          <SkeletonBar height={10} radius={'50%'} width={10} />
          <SkeletonBar height={14} width={56} />
        </Flexbox>
      ))}
    </Flexbox>
    {tabs && (
      <Flexbox
        style={{
          left: '50%',
          position: 'absolute',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        <SkeletonBar height={34} radius={cssVar.borderRadiusLG} width={244} />
      </Flexbox>
    )}
    {actions > 0 && (
      <Flexbox horizontal align={'center'} gap={8}>
        {Array.from({ length: actions }).map((_, index) => (
          <Center height={36} key={index} width={36}>
            <SkeletonBar height={20} width={20} />
          </Center>
        ))}
      </Flexbox>
    )}
  </Flexbox>
);

export default AgentProfileNavSkeleton;
