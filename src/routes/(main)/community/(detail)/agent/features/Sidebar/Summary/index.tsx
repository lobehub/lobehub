import { Accordion } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../../DetailProvider';

const Summary = memo(() => {
  const { description, summary } = useDetailContext();
  const { t } = useTranslation('discover');
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
              {summary || description}
            </p>
          ),
          key: 'summary',
          title: t('assistants.details.summary.title'),
        },
      ]}
    />
  );
});

export default Summary;
