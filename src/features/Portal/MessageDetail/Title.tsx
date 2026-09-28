import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { oneLineEllipsis } from '@/styles';

const Title = () => {
  const { t } = useTranslation('portal');

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <Text className={oneLineEllipsis} style={{ fontSize: 16 }} type={'secondary'}>
        {t('messageDetail')}
      </Text>
    </Flexbox>
  );
};

export default Title;
