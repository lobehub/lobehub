import dayjs from 'dayjs';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useStyles } from '../style';
import { ChatItemProps } from '../type';

export interface TitleProps {
  avatar: ChatItemProps['avatar'];
  className?: string;
  placement?: ChatItemProps['placement'];
  showTitle?: ChatItemProps['showTitle'];
  time?: ChatItemProps['time'];
  titleAddon?: ChatItemProps['titleAddon'];
}

const formatTime = (time: number): string => {
  const now = dayjs();
  const target = dayjs(time);

  if (target.isSame(now, 'day')) {
    return target.format('HH:mm:ss');
  } else if (target.isSame(now, 'year')) {
    return target.format('MM-DD HH:mm:ss');
  } else {
    return target.format('YYYY-MM-DD HH:mm:ss');
  }
};

const Title = memo<TitleProps>(({ showTitle, placement, time, avatar, titleAddon, className }) => {
  const { styles, cx } = useStyles({ placement, showTitle, time });

  return (
    <Flexbox
      align={'center'}
      className={cx(styles.name, className)}
      direction={placement === 'left' ? 'horizontal' : 'horizontal-reverse'}
      gap={4}
    >
      {showTitle ? avatar.title || 'untitled' : undefined}
      {showTitle ? titleAddon : undefined}
      {time && <time>{formatTime(time)}</time>}
    </Flexbox>
  );
});

export default Title;
