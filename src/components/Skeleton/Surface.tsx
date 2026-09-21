'use client';

import { Flexbox, FormGroup, Grid } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { ComponentType } from 'react';

import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';

export type SurfaceSkeletonVariant = 'detail' | 'editor' | 'form' | 'grid' | 'list';

interface SurfaceSkeletonProps {
  header?: boolean;
  variant?: SurfaceSkeletonVariant;
}

const styles = createStaticStyles(({ css }) => ({
  card: css`
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  divider: css`
    width: 100%;
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  editor: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  row: css`
    min-height: 64px;
    padding-block: 16px;
  `,
}));

const HeaderSkeleton = () => (
  <Flexbox
    horizontal
    align={'center'}
    flex={'none'}
    height={44}
    justify={'space-between'}
    paddingInline={16}
  >
    <SkeletonBar height={20} width={144} />
    <SkeletonBar height={28} width={72} />
  </Flexbox>
);

const ListSkeleton = () => (
  <Flexbox gap={12} padding={16}>
    {Array.from({ length: 5 }).map((_, index) => (
      <Flexbox className={styles.card} gap={10} key={index} padding={16}>
        <Flexbox horizontal align={'center'} gap={8}>
          <SkeletonBar height={24} radius={'50%'} width={24} />
          <SkeletonBar height={14} width={96 + (index % 3) * 24} />
        </Flexbox>
        <SkeletonBar height={12} width={`${58 + (index % 3) * 12}%`} />
        <SkeletonBar height={12} width={`${42 + (index % 2) * 16}%`} />
      </Flexbox>
    ))}
  </Flexbox>
);

const FormSkeleton = () => (
  <Flexbox align={'center'} padding={24}>
    <FormGroup
      collapsible={false}
      style={{ width: 'min(800px, 100%)' }}
      title={<SkeletonBar height={18} width={112} />}
      variant={'filled'}
    >
      <Flexbox>
        {Array.from({ length: 3 }).map((_, index) => (
          <Flexbox key={index}>
            {index > 0 && <div className={styles.divider} />}
            <Flexbox
              horizontal
              align={'center'}
              className={styles.row}
              gap={24}
              justify={'space-between'}
            >
              <Flexbox gap={8}>
                <SkeletonBar height={16} width={112 + index * 24} />
                <SkeletonBar height={12} width={220 + index * 28} />
              </Flexbox>
              <SkeletonBar height={32} width={index % 2 ? 152 : 88} />
            </Flexbox>
          </Flexbox>
        ))}
      </Flexbox>
    </FormGroup>
  </Flexbox>
);

const GridSkeleton = () => (
  <Grid gap={16} maxItemWidth={320} padding={16} rows={3}>
    {Array.from({ length: 6 }).map((_, index) => (
      <Flexbox gap={12} key={index} padding={16}>
        <SkeletonBar height={120} radius={cssVar.borderRadiusLG} />
        <SkeletonBar height={16} width={'72%'} />
        <SkeletonBar height={12} width={'48%'} />
      </Flexbox>
    ))}
  </Grid>
);

const DetailSkeleton = () => (
  <Flexbox align={'center'} padding={'32px 24px'}>
    <Flexbox gap={24} width={'min(960px, 100%)'}>
      <Flexbox horizontal align={'center'} gap={16}>
        <SkeletonBar height={64} radius={'50%'} width={64} />
        <Flexbox flex={1} gap={8}>
          <SkeletonBar height={22} width={'32%'} />
          <SkeletonBar height={14} width={'48%'} />
        </Flexbox>
        <SkeletonBar height={36} radius={18} width={104} />
      </Flexbox>
      <Flexbox horizontal gap={8}>
        <SkeletonBar height={22} radius={11} width={72} />
        <SkeletonBar height={22} radius={11} width={96} />
        <SkeletonBar height={22} radius={11} width={64} />
      </Flexbox>
      <Flexbox gap={12}>
        <SkeletonBar height={14} width={'94%'} />
        <SkeletonBar height={14} width={'88%'} />
        <SkeletonBar height={14} width={'62%'} />
        <SkeletonBar height={180} radius={cssVar.borderRadiusLG} />
      </Flexbox>
    </Flexbox>
  </Flexbox>
);

const EditorSkeleton = () => (
  <Flexbox align={'center'} flex={1} padding={'32px 24px'}>
    <Flexbox
      className={styles.editor}
      gap={20}
      padding={'32px 40px 96px'}
      width={'min(760px, 100%)'}
    >
      <SkeletonBar height={28} width={'54%'} />
      <SkeletonBar height={14} width={'92%'} />
      <SkeletonBar height={14} width={'86%'} />
      <SkeletonBar height={14} width={'64%'} />
      <SkeletonBar height={180} radius={12} />
    </Flexbox>
  </Flexbox>
);

const SurfaceSkeleton = ({ header = true, variant = 'list' }: SurfaceSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    {header && <HeaderSkeleton />}
    <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
      {variant === 'list' && <ListSkeleton />}
      {variant === 'form' && <FormSkeleton />}
      {variant === 'grid' && <GridSkeleton />}
      {variant === 'editor' && <EditorSkeleton />}
      {variant === 'detail' && <DetailSkeleton />}
    </Flexbox>
  </Flexbox>
);

const surfaceSkeletonCache = new Map<string, ComponentType<RouteSkeletonProps>>();

export const createSurfaceSkeleton = (variant: SurfaceSkeletonVariant, header = true) => {
  const key = `${variant}:${header}`;
  const cached = surfaceSkeletonCache.get(key);
  if (cached) return cached;

  const Component = ({ chrome = 'page' }: RouteSkeletonProps) => (
    <SurfaceSkeleton header={header && chrome !== 'body'} variant={variant} />
  );
  Component.displayName = `SurfaceSkeleton(${key})`;
  surfaceSkeletonCache.set(key, Component);
  return Component;
};

export default SurfaceSkeleton;
