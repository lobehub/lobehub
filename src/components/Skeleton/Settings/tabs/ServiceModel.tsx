'use client';

import { Flexbox } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';

import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';

import SkeletonBar from '../../Bar';
import SettingsSectionSkeleton from '../Section';
import { sectionGroupStyles } from '../sectionGroupStyles';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/** Width of the settled tier picker (`PICKER_WIDTH` is the advanced column; the picker is close). */
const PICKER = { height: 32, width: 260 };

type Text = ReturnType<typeof useSkeletonText>;

/** One model card: tier title + description head, the picker row, and optionally the 「高级」 line. */
const TierGroup = ({
  advanced,
  desc,
  label,
  text,
  title,
}: {
  advanced?: boolean;
  desc: string;
  label?: string;
  text: Text;
  title: string;
}) => (
  <Form.Group
    className={sectionGroupStyles.group}
    collapsible={false}
    desc={text(desc, 220, 12)}
    title={text(title, 80, 18)}
    variant={'filled'}
  >
    <Flexbox paddingInline={16}>
      <Flexbox horizontal align={'center'} height={64} justify={'space-between'}>
        <span style={{ fontSize: 14 }}>{text(label ?? 'serviceModel.tierPicker', 32, 14)}</span>
        <SkeletonBar height={PICKER.height} radius={cssVar.borderRadius} width={PICKER.width} />
      </Flexbox>
      {advanced && (
        <Flexbox horizontal align={'center'} gap={8} height={24} style={{ marginBottom: 16 }}>
          <span style={{ color: cssVar.colorTextSecondary, fontSize: 12, fontWeight: 500 }}>
            {text('serviceModel.advanced.title', 28, 12)}
          </span>
          <SkeletonBar height={12} width={240} />
        </Flexbox>
      )}
    </Flexbox>
  </Form.Group>
);

/** The image-generation form below the model cards: one default-count slider row. */
export const ImageSettingsSkeleton = () => {
  const text = useSkeletonText('setting');

  return (
    <SettingsSectionSkeleton
      groups={[
        {
          control: { height: 32, width: 335 },
          labels: [text('settingImage.defaultCount.label', 96)],
          rows: 1,
          title: text('settingImage.defaultCount.title', 32, 18),
        },
      ]}
    />
  );
};

/**
 * The service-model tab: one grouped form of model cards 16px apart (main and
 * flash carry a folded 「高级」 line), then the image form 36px below.
 */
export const ServiceModelFormSkeleton = () => {
  const text = useSkeletonText('setting');
  const enableChannels = useServerConfigStore(serverConfigSelectors.enableChannels);

  return (
    <Flexbox aria-busy gap={16}>
      {(['main', 'flash', 'verify', 'embedding'] as const).map((tier) => (
        <TierGroup
          advanced={tier === 'main' || tier === 'flash'}
          desc={`serviceModel.tier.${tier}.desc`}
          key={tier}
          text={text}
          title={`serviceModel.tier.${tier}.title`}
        />
      ))}
      <TierGroup
        desc={'serviceModel.voice.desc'}
        label={'systemAgent.asr.title'}
        text={text}
        title={'serviceModel.voice.title'}
      />
      {enableChannels && (
        <TierGroup
          desc={'systemAgent.channelRouting.modelDesc'}
          text={text}
          title={'systemAgent.channelRouting.title'}
        />
      )}
    </Flexbox>
  );
};

const Body = () => {
  const { showAiImage } = useServerConfigStore(featureFlagsSelectors);

  return (
    <>
      <ServiceModelFormSkeleton />
      {showAiImage && <ImageSettingsSkeleton />}
    </>
  );
};

const ServiceModelSkeleton: SettingsTabSkeleton = { Body };

export default ServiceModelSkeleton;
