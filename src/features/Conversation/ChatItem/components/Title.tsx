import { Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type {ChatItemProps} from '../type';

export interface TitleProps {
  avatar: ChatItemProps['avatar'];
  showTitle?: ChatItemProps['showTitle'];
  time?: ChatItemProps['time'];
  titleAddon?: ChatItemProps['titleAddon'];
}

const Title = memo<TitleProps>(({ showTitle, time, avatar, titleAddon }) => {
  const { t } = useTranslation('chat');
  const title = avatar.title || t('untitledAgent');

  return (
    <>
      {showTitle && (
        <Text fontSize={14} weight={500}>
          {title}
        </Text>
      )}
      {showTitle ? titleAddon : undefined}
      {!time ? null : (
        <Text
          aria-label="published-date"
          as={'time'}
          fontSize={12}
          title={dayjs(time).format('YYYY-MM-DD HH:mm:ss')}
          type={'secondary'}
        >
          {dayjs(time).fromNow()}
        </Text>
      )}
    </>
  );
});

export default Title;
