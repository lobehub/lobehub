'use client';

import { Collapse, Flexbox, Icon, Tag } from '@lobehub/ui';
import { type LucideIcon } from 'lucide-react';
import {
  ChartColumnBig,
  Delete,
  FileMinus,
  MessageSquareText,
  Pickaxe,
  Thermometer,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Title from '@/app/[variants]/(main)/community/features/Title';
import { formatTokenNumber } from '@/utils/format';

import { useDetailContext } from '../../DetailProvider';
import ParameterItem from './ParameterItem';

interface Parameter {
  defaultValue: string | number;
  desc: string;
  icon: LucideIcon;
  key: string;
  label: string;
  range?: (string | number)[];
  type: string;
}

const ParameterList = memo(() => {
  const { t } = useTranslation('discover');
  const data = useDetailContext();

  const items: Parameter[] = [
    {
      defaultValue: 1,
      desc: t('models.parameterList.temperature.desc'),
      icon: Thermometer,
      key: 'temperature',
      label: t('models.parameterList.temperature.title'),
      range: [0, 2],
      type: 'float',
    },
    {
      defaultValue: 1,
      desc: t('models.parameterList.top_p.desc'),
      icon: ChartColumnBig,
      key: 'top_p',
      label: t('models.parameterList.top_p.title'),
      range: [0, 1],
      type: 'float',
    },
    {
      defaultValue: 0,
      desc: t('models.parameterList.presence_penalty.desc'),
      icon: Delete,
      key: 'presence_penalty',
      label: t('models.parameterList.presence_penalty.title'),
      range: [-2, 2],
      type: 'float',
    },
    {
      defaultValue: 0,
      desc: t('models.parameterList.frequency_penalty.desc'),
      icon: FileMinus,
      key: 'frequency_penalty',
      label: t('models.parameterList.frequency_penalty.title'),
      range: [-2, 2],
      type: 'float',
    },
    {
      defaultValue: '--',
      desc: t('models.parameterList.max_tokens.desc'),
      icon: MessageSquareText,
      key: 'max_tokens',
      label: t('models.parameterList.max_tokens.title'),
      range: Boolean(data?.maxOutput || data?.maxDimension)
        ? [0, formatTokenNumber(data?.maxOutput || data?.maxDimension || 0)]
        : undefined,
      type: 'int',
    },
    {
      defaultValue: '--',
      desc: t('models.parameterList.reasoning_effort.desc'),
      icon: Pickaxe,
      key: 'reasoning_effort',
      label: t('models.parameterList.reasoning_effort.title'),
      range: ['low', 'high'],
      type: 'string',
    },
  ];

  return (
    <Flexbox gap={16}>
      <Title>{t('models.parameterList.title')}</Title>
      <Collapse
        defaultActiveKey={items.map((item) => item.key)}
        expandIconPlacement={'end'}
        gap={16}
        variant={'outlined'}
        items={items.map((item) => ({
          children: <ParameterItem {...item} key={item.key} />,
          key: item.key,
          label: (
            <Flexbox horizontal align={'center'} gap={8}>
              <Icon icon={item.icon} size={16} />
              {item.label}
              <Tag>{item.key}</Tag>
            </Flexbox>
          ),
        }))}
      />
    </Flexbox>
  );
});

export default ParameterList;
