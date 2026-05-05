import { formatActivityTime } from '@lobechat/utils/time';
import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export const Time = memo<{ date: string | number | Date }>(({ date }) => {
  const { t } = useTranslation('discover');
  const { text, title } = formatActivityTime(date, {
    formatOtherYear: t('time.formatOtherYear'),
    formatThisYear: t('time.formatThisYear'),
  });
  if (!text) return null;
  return (
    <Text fontSize={12} style={{ flex: 'none' }} title={title} type={'secondary'}>
      {text}
    </Text>
  );
});

export default Time;
