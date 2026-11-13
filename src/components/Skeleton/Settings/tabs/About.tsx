'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Divider, Flexbox, Grid } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '../../Bar';
import { SettingsFormSkeleton, SWITCH_CONTROL } from '../Section';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

const SOCIAL_COUNT = 5;

const sectionTitle = {
  color: cssVar.colorTextSecondary,
  fontSize: 14,
  fontWeight: 'bold',
} as const;

/** A row of external links (contact / legal); the labels are static copy. */
const LinkRow = ({ keys }: { keys: string[] }) => {
  const common = useSkeletonText('common');
  return (
    <Flexbox horizontal align={'center'} gap={24} wrap={'wrap'}>
      {keys.map((key) => (
        <Flexbox horizontal align={'center'} gap={8} key={key}>
          {common(key, 56, 14)}
          <SkeletonBar height={14} width={14} />
        </Flexbox>
      ))}
    </Flexbox>
  );
};

/**
 * The "About" group (logo + version row, the five social cards, contact and
 * legal links) above the single-row analytics group.
 */
const Body = () => {
  const { t, ready } = useTranslation('common');
  const setting = useSkeletonText('setting');
  const { t: tSetting, ready: settingReady } = useTranslation('setting');

  return (
    <>
      <Form.Group
        collapsible={false}
        style={{ maxWidth: '1024px', width: '100%' }}
        title={ready ? `${t('about')} ${BRANDING_NAME}` : <SkeletonBar height={18} width={104} />}
        variant={'filled'}
      >
        <Flexbox gap={20} paddingBlock={20} width={'100%'}>
          <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} width={'100%'}>
            <Flexbox horizontal align={'center'} gap={16}>
              <SkeletonBar height={64} radius={16} width={64} />
              <Flexbox align={'flex-start'} gap={6}>
                <div style={{ fontSize: 18, fontWeight: 'bolder' }}>{BRANDING_NAME}</div>
                <SkeletonBar height={22} width={56} />
              </Flexbox>
            </Flexbox>
            <SkeletonBar height={32} radius={8} width={80} />
          </Flexbox>
          <Divider style={{ marginBlock: 0 }} />
          <Grid gap={8} maxItemWidth={160} rows={SOCIAL_COUNT} width={'100%'}>
            {Array.from({ length: SOCIAL_COUNT }, (_, index) => (
              <SkeletonBar height={46} key={index} radius={8} />
            ))}
          </Grid>
          <Divider style={{ marginBlock: 0 }} />
          <div style={sectionTitle}>
            {ready ? t('contact') : <SkeletonBar height={14} width={56} />}
          </div>
          <LinkRow keys={['officialSite', 'mail.support', 'mail.business']} />
          <Divider style={{ marginBlock: 0 }} />
          <div style={sectionTitle}>
            {ready ? t('legal') : <SkeletonBar height={14} width={56} />}
          </div>
          <LinkRow keys={['terms', 'privacy']} />
        </Flexbox>
      </Form.Group>
      <SettingsFormSkeleton
        groups={[
          {
            items: [
              {
                control: SWITCH_CONTROL,
                desc: settingReady ? (
                  tSetting('analytics.telemetry.desc', { appName: BRANDING_NAME })
                ) : (
                  <SkeletonBar height={12} width={220} />
                ),
                label: setting('analytics.telemetry.title', 112, 14),
                minWidth: undefined,
              },
            ],
            title: setting('analytics.title', 64),
          },
        ]}
      />
    </>
  );
};

const AboutSkeleton: SettingsTabSkeleton = { Body };

export default AboutSkeleton;
