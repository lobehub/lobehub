import { Collapse } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../../DetailProvider';

const Summary = memo(() => {
  const { description, summary } = useDetailContext();
  const { t } = useTranslation('discover');
  return (
    <Collapse
      defaultActiveKey={['summary']}
      expandIconPlacement={'end'}
      size={'small'}
      variant={'borderless'}
      items={[
        {
          children: (
            <p
              style={{
                color: cssVar.colorTextSecondary,
                margin: 0,
              }}
            >
              {summary || description}
            </p>
          ),
          key: 'summary',
          label: t('assistants.details.summary.title'),
        },
      ]}
    />
  );
});

export default Summary;
