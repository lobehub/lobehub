import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityTime } from '@/hooks/useActivityTime';

import { type ChatItemProps } from '../type';

export interface TitleProps {
  avatar: ChatItemProps['avatar'];
  showTitle?: ChatItemProps['showTitle'];
  time?: ChatItemProps['time'];
  titleAddon?: ChatItemProps['titleAddon'];
}

const Title = memo<TitleProps>(({ showTitle, time, avatar, titleAddon }) => {
  const { t } = useTranslation('chat');
  const title = avatar.title || t('untitledAgent');
  const { text: timeText, title: timeTitle } = useActivityTime(time);

  return (
    <>
      {showTitle && (
        <Text fontSize={14} weight={500}>
          {title}
        </Text>
      )}
      {showTitle ? titleAddon : undefined}
      {!timeText ? null : (
        <Text
          aria-label="published-date"
          as={'time'}
          fontSize={12}
          title={timeTitle}
          type={'secondary'}
        >
          {timeText}
        </Text>
      )}
    </>
  );
});

export default Title;
