import { Collapse } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailData } from '../../DetailProvider';

const Summary = memo(() => {
  const data = useDetailData();
  const { t } = useTranslation('discover');

  const { currentVersion, group } = data;
  const description = currentVersion?.description || 'No description provided';

  return (
    <Collapse
      defaultActiveKey={['summary']}
      expandIconPlacement={'end'}
      items={[
        {
          children: (
            <p
              style={{
                color: cssVar.colorTextSecondary,
                margin: 0,
              }}
            >
              {description}
            </p>
          ),
          key: 'summary',
          label: t('groupAgents.details.summary.title', {
            defaultValue: 'What can you use this group for?',
          }),
        },
      ]}
      size={'small'}
      variant={'borderless'}
    />
  );
});

export default Summary;
