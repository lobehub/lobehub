import { Accordion } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../../DetailProvider';

const Summary = memo(() => {
  const { description, summary } = useDetailContext();
  const { t } = useTranslation('discover');

  const displayDescription = summary || description || 'No description provided';

  return (
    <Accordion
      defaultValue={['summary']}
      indicatorPlacement={'end'}
      styles={{ trigger: { paddingInline: 0 } }}
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
          title: t('groupAgents.details.summary.title', {
            defaultValue: 'What can you use this group for?',
          }),
        },
      ]}
    />
  );
});

export default Summary;
