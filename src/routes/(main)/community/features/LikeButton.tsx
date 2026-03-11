import { Button, Flexbox, Icon, Tooltip, TooltipGroup } from '@lobehub/ui';
import { Space } from 'antd';
import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatShortenNumber } from '@/utils/format';

import { styles } from '../components/Statistic';

interface LikeButtonProps {
  count: number;
  isDisliked?: boolean;
  isLiked?: boolean;
  onDislikeClick?: (active: boolean) => void;
  onLikeClick?: (active: boolean) => void;
  showDislike?: boolean;
}

const LikeButton = memo<LikeButtonProps>(
  ({ count, onLikeClick, onDislikeClick, isLiked, showDislike, isDisliked }) => {
    const { t } = useTranslation('discover');

    if (showDislike)
      return (
        <TooltipGroup>
          <Space.Compact style={{ flex: 1.75 }}>
            <Tooltip title={t('like')}>
              <Button
                block
                className={styles.number}
                icon={ThumbsUpIcon}
                size={'large'}
                style={{ flex: 1 }}
                type={isLiked ? 'primary' : undefined}
                onClick={() => onLikeClick?.(!isLiked)}
              >
                {formatShortenNumber(count)}
              </Button>
            </Tooltip>
            <Tooltip title={t('dislike')}>
              <Button
                className={styles.number}
                icon={<Icon icon={ThumbsDownIcon} />}
                size={'large'}
                style={{ flex: 'none' }}
                type={isDisliked ? 'primary' : 'default'}
                onClick={() => onDislikeClick?.(!isDisliked)}
              />
            </Tooltip>
          </Space.Compact>
        </TooltipGroup>
      );

    return (
      <Flexbox align={'center'} flex={1} justify={'center'} style={{ position: 'relative' }}>
        <Tooltip title={t('like')}>
          <Button
            className={styles.number}
            icon={<Icon icon={ThumbsUpIcon} />}
            size={'large'}
            style={{ width: '100%' }}
            type={isLiked ? 'primary' : 'default'}
            onClick={() => onLikeClick?.(!isLiked)}
          >
            {formatShortenNumber(count)}
          </Button>
        </Tooltip>
      </Flexbox>
    );
  },
);

export default LikeButton;
