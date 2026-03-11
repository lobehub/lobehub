import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Statistic from '../../../../../components/Statistic';

const DEFAULT_DOC_URL = 'https://lobehub.com/docs/usage/agents/model';

export interface ParameterItemProps {
  defaultValue: string | number;
  desc: string;
  docUrl?: string;
  range?: (string | number)[];
  type: string;
}

const formatNum = (num: string | number) => {
  return typeof num === 'number' ? num.toFixed(2) : num.toUpperCase();
};

const ParameterItem = memo<ParameterItemProps>(
  ({ docUrl = DEFAULT_DOC_URL, desc, type, defaultValue, range }) => {
    const { t } = useTranslation('discover');

    return (
      <Flexbox align={'flex-start'} gap={16}>
        <p style={{ color: cssVar.colorTextSecondary, margin: 0 }}>
          {desc}{' '}
          <a href={docUrl} rel="noreferrer" target="_blank">
            {t('models.parameterList.docs')}
          </a>
        </p>
        <Divider dashed style={{ margin: 0 }} />
        <Flexbox horizontal align={'center'} gap={16} style={{ paddingBottom: 8 }} wrap={'wrap'}>
          <Statistic
            gap={4}
            title={t('models.parameterList.type')}
            value={<code>{type.toUpperCase()}</code>}
            valuePlacement={'bottom'}
            valueStyle={{ fontSize: 14 }}
            width={100}
          />
          <Statistic
            gap={4}
            title={t('models.parameterList.defaultValue')}
            value={formatNum(defaultValue)}
            valuePlacement={'bottom'}
            valueStyle={{ fontSize: 14 }}
            width={100}
          />
          {range && (
            <Statistic
              gap={4}
              title={t('models.parameterList.range')}
              value={range.map((item) => (type === 'float' ? formatNum(item) : item)).join(' ~ ')}
              valuePlacement={'bottom'}
              valueStyle={{ fontSize: 14 }}
              width={100}
            />
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default ParameterItem;
