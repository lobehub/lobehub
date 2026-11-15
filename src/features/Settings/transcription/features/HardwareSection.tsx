'use client';

import type { LocalAsrHardwareInfo, LocalAsrHardwareTier } from '@lobechat/electron-client-ipc';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { formatSize } from '@/utils/format';

const TIER_COLOR: Record<LocalAsrHardwareTier, string> = {
  limited: 'warning',
  recommended: 'success',
  supported: 'processing',
  unsupported: 'error',
};

const HardwareSection = ({ hardware }: { hardware: LocalAsrHardwareInfo }) => {
  const { t } = useTranslation('setting');
  const form = useForm();

  const group: FormGroupItem = {
    children: [
      {
        children: (
          <Text>
            {t('localAsr.hardware.cpuValue', {
              arch: hardware.arch,
              cores: hardware.cpuCores,
              model: hardware.cpuModel,
            })}
          </Text>
        ),
        label: t('localAsr.hardware.cpu'),
        minWidth: undefined,
      },
      {
        children: <Text>{formatSize(hardware.totalMemoryBytes, 0)}</Text>,
        label: t('localAsr.hardware.memory'),
        minWidth: undefined,
      },
      {
        children: (
          <Text>
            {t('localAsr.hardware.diskValue', {
              free:
                hardware.freeDiskBytes === undefined ? '--' : formatSize(hardware.freeDiskBytes),
              required: formatSize(hardware.requiredDiskBytes, 0),
            })}
          </Text>
        ),
        label: t('localAsr.hardware.disk'),
        minWidth: undefined,
      },
      {
        children: (
          <Tag color={TIER_COLOR[hardware.tier]} data-testid={'local-asr-hardware-tier'}>
            {t(`localAsr.hardware.tier.${hardware.tier}`)}
          </Tag>
        ),
        desc: (
          <Flexbox gap={2}>
            {hardware.reasons.map((reason) => (
              <span key={reason}>{t(`localAsr.hardware.reason.${reason}`)}</span>
            ))}
          </Flexbox>
        ),
        label: t('localAsr.hardware.verdict'),
        minWidth: undefined,
      },
      {
        children: null,
        desc: t('localAsr.hardware.benchmarkDesc'),
        label: t('localAsr.hardware.benchmark'),
        minWidth: undefined,
      },
    ],
    desc: t('localAsr.hardware.desc'),
    title: t('localAsr.hardware.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[group]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
};

export default HardwareSection;
