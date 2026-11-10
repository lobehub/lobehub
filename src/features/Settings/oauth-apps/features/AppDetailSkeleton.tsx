'use client';

import { Flexbox, Tabs, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { SkeletonBar } from '@/components/Skeleton';

const styles = stylex.create({
  // Same frame as `SectionCard`.
  card: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
  },
});

const Line = ({ bar, height, width }: { bar: number; height: number; width: number | string }) => (
  <Flexbox height={height} justify={'center'} style={{ minWidth: 0 }}>
    <SkeletonBar height={bar} width={width} />
  </Flexbox>
);

/** `SectionCard` chrome with its real (static) title. */
const Card = ({ children, title }: { children: ReactNode; title: ReactNode }) => (
  <Flexbox gap={16} {...stylex.props(styles.card)}>
    <Flexbox horizontal align={'center'} style={{ minHeight: 28 }}>
      <Text weight={500}>{title}</Text>
    </Flexbox>
    {children}
  </Flexbox>
);

/** A vertical form field: label line over a filled input of `height`. */
const Field = ({ height = 32, label }: { height?: number; label: ReactNode }) => (
  <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
    <Text>{label}</Text>
    <SkeletonBar height={height} radius={cssVar.borderRadius} />
  </Flexbox>
);

/**
 * An OAuth app page while it loads (also while the Labs flag resolves on a
 * direct visit): back + name + meta header, the tab strip, and the Overview
 * tab's basic-info and integration cards. Tab, card and field labels are
 * static copy and render as text.
 */
const AppDetailSkeleton = () => {
  const { t } = useTranslation('auth');

  return (
    <Flexbox aria-busy data-testid={'oauth-app-detail-skeleton'} gap={20}>
      <Flexbox gap={4}>
        <Flexbox horizontal align={'center'} gap={8}>
          <SkeletonBar height={24} width={24} />
          <Line bar={20} height={30} width={160} />
        </Flexbox>
        <Flexbox style={{ paddingInlineStart: 36 }}>
          <Line bar={12} height={20} width={200} />
        </Flexbox>
      </Flexbox>

      <Tabs
        activeKey={'overview'}
        items={[
          { key: 'overview', label: t('oauthApp.detail.tabs.overview') },
          { key: 'credentials', label: t('oauthApp.detail.tabs.credentials') },
          { key: 'advanced', label: t('oauthApp.detail.tabs.advanced') },
        ]}
      />

      <Card title={t('oauthApp.detail.basicInfo')}>
        <Flexbox gap={16}>
          <Flexbox horizontal align={'flex-end'} gap={16}>
            <SkeletonBar height={64} radius={cssVar.borderRadiusLG} width={64} />
            <Field label={t('oauthApp.form.name.label')} />
          </Flexbox>
          <Field height={54} label={t('oauthApp.form.description.label')} />
        </Flexbox>
      </Card>

      <Card title={t('oauthApp.integration.title')}>
        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
            <Flexbox gap={2}>
              <Text fontSize={13} weight={500}>
                {t('oauthApp.integration.oneClick')}
              </Text>
              <Text style={{ fontSize: 12 }} type={'secondary'}>
                {t('oauthApp.integration.oneClickDesc')}
              </Text>
            </Flexbox>
            <SkeletonBar height={32} width={120} />
          </Flexbox>
          <SkeletonBar height={180} radius={cssVar.borderRadius} />
        </Flexbox>
      </Card>
    </Flexbox>
  );
};

export default AppDetailSkeleton;
