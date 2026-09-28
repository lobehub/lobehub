'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';

import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';

type ProfileSkeletonVariant = 'agent' | 'group';

interface ProfileSkeletonProps extends RouteSkeletonProps {
  variant?: ProfileSkeletonVariant;
}

const styles = createStaticStyles(({ css }) => ({
  configPanel: css`
    padding: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  cover: css`
    width: calc(100% + 32px);
    height: 80px;
    margin-inline: -16px;
    background: ${cssVar.colorFillQuaternary};
  `,
  divider: css`
    width: 100%;
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  editor: css`
    padding-block: 24px 96px;
  `,
  header: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const NavigationSkeleton = () => <Flexbox className={styles.header} flex={'none'} height={44} />;

const EditorPlaceholder = () => (
  <Flexbox className={styles.editor} gap={14}>
    <SkeletonBar height={18} width={120} />
    <SkeletonBar height={14} width={'92%'} />
    <SkeletonBar height={14} width={'84%'} />
    <SkeletonBar height={14} width={'66%'} />
  </Flexbox>
);

const AgentProfileSkeleton = () => (
  <WideScreenContainer>
    <Flexbox style={{ marginBottom: 28 }}>
      <Flexbox paddingBlock={'0 16px'} style={{ marginInline: -16 }}>
        <div className={styles.cover} />
        <Flexbox
          horizontal
          align={'flex-end'}
          gap={16}
          paddingInline={24}
          style={{ marginTop: -36 }}
        >
          <SkeletonBar height={72} radius={cssVar.borderRadiusLG} width={72} />
          <Flexbox gap={8} style={{ minWidth: 0, paddingBottom: 4 }}>
            <SkeletonBar height={36} width={220} />
            <SkeletonBar height={14} width={156} />
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox className={styles.configPanel} gap={14}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <SkeletonBar height={12} width={96} />
          <SkeletonBar height={12} width={72} />
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <SkeletonBar height={32} width={196} />
          <SkeletonBar height={32} width={112} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
    <EditorPlaceholder />
  </WideScreenContainer>
);

const GroupProfileSkeleton = () => (
  <WideScreenContainer>
    <Flexbox height={66} justify={'center'}>
      <SkeletonBar height={14} width={96} />
    </Flexbox>
    <Flexbox gap={16} paddingBlock={16}>
      <SkeletonBar height={72} radius={cssVar.borderRadiusLG} width={72} />
      <SkeletonBar height={36} width={240} />
    </Flexbox>
    <Flexbox horizontal gap={8} style={{ marginBlock: '16px 28px' }}>
      <SkeletonBar height={32} width={132} />
      <SkeletonBar height={32} width={96} />
    </Flexbox>
    <div className={styles.divider} />
    <EditorPlaceholder />
  </WideScreenContainer>
);

const ProfileSkeleton = ({ chrome = 'page', variant = 'agent' }: ProfileSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    {chrome !== 'body' && <NavigationSkeleton />}
    <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden', overflowY: 'auto' }}>
      {variant === 'agent' ? <AgentProfileSkeleton /> : <GroupProfileSkeleton />}
    </Flexbox>
  </Flexbox>
);

export const GroupProfileRouteSkeleton = (props: RouteSkeletonProps) => (
  <ProfileSkeleton variant={'group'} {...props} />
);

export default ProfileSkeleton;
