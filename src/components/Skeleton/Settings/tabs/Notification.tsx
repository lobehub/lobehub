'use client';

import { Flexbox } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { SUPPORTED_MESSENGER_PLATFORMS } from '@/features/Messenger/platforms';

import SkeletonBar from '../../Bar';
import { SettingsFormSkeleton, SWITCH_CONTROL } from '../Section';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton, SettingsTabSkeletonProps } from './types';

const BASE_CHANNELS = ['inbox', 'email', 'push'] as const;

/**
 * Types listed on a channel page when the caller cannot supply them (the route
 * skeleton). The real list comes from the deployment's notification registry.
 */
const TYPE_ROWS = 6;

const platformName = (id: string) => SUPPORTED_MESSENGER_PLATFORMS.find((p) => p.id === id)?.name;

/** One channel row: 40px icon tile, real channel name, status line and chevron. */
const ChannelRow = ({ divider, title }: { divider: boolean; title: ReactNode }) => (
  <div style={{ marginInline: -8, paddingInline: 8 }}>
    <Form.Field
      avatar={<SkeletonBar height={40} width={40} />}
      divider={divider}
      label={title}
      layout={'horizontal'}
      desc={
        <Flexbox horizontal align={'center'} gap={8}>
          <span
            style={{
              background: cssVar.colorTextQuaternary,
              borderRadius: '50%',
              flex: 'none',
              height: 6,
              width: 6,
            }}
          />
          <SkeletonBar height={12} width={88} />
        </Flexbox>
      }
    >
      <SkeletonBar height={16} width={16} />
    </Form.Field>
  </div>
);

/** Channel index: the base channels and messenger platforms, then the summary switch. */
const IndexSkeleton = () => {
  const text = useSkeletonText('setting');
  const form = useForm();

  const rows = (
    <>
      {BASE_CHANNELS.map((channel, index) => (
        <ChannelRow
          divider={index > 0}
          key={channel}
          title={text(`notification.${channel}.title`, 64, 14)}
        />
      ))}
      {SUPPORTED_MESSENGER_PLATFORMS.map(({ id, name }) => (
        <ChannelRow divider key={id} title={name} />
      ))}
    </>
  );

  return (
    <div aria-busy data-testid={'settings-form-skeleton'}>
      <Form
        collapsible={false}
        form={form}
        itemsType={'group'}
        variant={'filled'}
        items={[
          { children: rows, title: text('notification.title', 64) },
          {
            children: [
              {
                children: <SkeletonBar {...SWITCH_CONTROL} />,
                desc: text('notification.content.scheduledTaskSummary.desc', 280, 12),
                label: text('notification.content.scheduledTaskSummary.title', 120, 14),
                layout: 'horizontal',
                minWidth: undefined,
              },
            ],
            title: text('notification.content.title', 64),
          },
        ]}
        {...FORM_STYLE}
      />
    </div>
  );
};

/** Channel page: back + title row, description, the enable group and the type switches. */
const DetailSkeleton = ({ channel, typeLabels }: { channel: string; typeLabels?: ReactNode[] }) => {
  const { t, ready } = useTranslation('setting');
  const text = useSkeletonText('setting');
  const platform = platformName(channel);
  const title =
    platform ??
    ((BASE_CHANNELS as readonly string[]).includes(channel) && ready
      ? t(`notification.${channel as (typeof BASE_CHANNELS)[number]}.title`)
      : undefined);

  return (
    <Flexbox aria-busy gap={16}>
      <Flexbox horizontal align={'center'} gap={4}>
        <SkeletonBar height={24} width={24} />
        <Flexbox height={25} justify={'center'}>
          {title ? (
            <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
          ) : (
            <SkeletonBar height={18} width={96} />
          )}
        </Flexbox>
      </Flexbox>
      <SkeletonBar height={14} width={320} />
      <SettingsFormSkeleton
        groups={[
          {
            items: [
              {
                control: SWITCH_CONTROL,
                label: <SkeletonBar height={14} width={120} />,
                minWidth: undefined,
              },
            ],
            title: title ?? <SkeletonBar height={18} width={96} />,
          },
          {
            items: (
              typeLabels ??
              Array.from({ length: TYPE_ROWS }, (_, index) => (
                <SkeletonBar height={14} key={index} width={96 + (index % 3) * 32} />
              ))
            ).map((label) => ({ control: SWITCH_CONTROL, label, minWidth: undefined })),
            title: text('notification.channel.types.title', 64),
          },
        ]}
      />
    </Flexbox>
  );
};

interface NotificationSkeletonProps extends SettingsTabSkeletonProps {
  /** The channel page's type labels, when the page already knows them. */
  typeLabels?: ReactNode[];
}

const Body = ({ sub, typeLabels }: NotificationSkeletonProps) =>
  sub ? <DetailSkeleton channel={sub} typeLabels={typeLabels} /> : <IndexSkeleton />;

const NotificationSkeleton = { Body } satisfies SettingsTabSkeleton;

export default NotificationSkeleton;
