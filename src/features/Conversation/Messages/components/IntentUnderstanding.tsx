import { Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import CircleLoader from '@/components/CircleLoader';
import { shinyTextStyles } from '@/styles';

const IntentUnderstanding = () => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox align={'center'} gap={8} horizontal>
      <CircleLoader />
      <Flexbox className={shinyTextStyles.shinyText} horizontal>
        {t('intentUnderstanding.title')}
      </Flexbox>
    </Flexbox>
  );
};
export default IntentUnderstanding;
