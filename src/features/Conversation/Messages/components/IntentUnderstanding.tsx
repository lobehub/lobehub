import { Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import CircleLoader from '@/components/CircleLoader';
import { shinyTextStyles } from '@/styles';

const IntentUnderstanding = () => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <CircleLoader />
      <Flexbox horizontal className={shinyTextStyles.shinyText}>
        {t('intentUnderstanding.title')}
      </Flexbox>
    </Flexbox>
  );
};
export default IntentUnderstanding;
