import { Collapse } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../../DetailProvider';

const Summary = memo(() => {
  const { description, summary } = useDetailContext();
  const { t } = useTranslation('discover');

  const displayDescription = summary || description || 'No description provided';

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
              {displayDescription}
            </p>
          ),
          key: 'summary',
          label: t('groupAgents.details.summary.title', {
            defaultValue: 'What can you use this group for?',
          }),
        },
      ]}
    />
  );
});

export default Summary;
