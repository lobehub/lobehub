import { Block, Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { App, Divider } from 'antd';
import { cssVar, cx } from 'antd-style';
import { memo, type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BriefCardSummary from '@/features/DailyBrief/BriefCardSummary';
import { styles as briefStyles } from '@/features/DailyBrief/style';

import { styles } from './style';

interface RecommendationCardProps {
  ctaKey: string;
  descriptionKey: string;
  i18nValues?: Record<string, string>;
  icon: ReactNode;
  /** Async handler for the primary CTA. */
  onAction: () => Promise<void>;
  tagKey?: string;
  titleKey: string;
}

export const RecommendationCard = memo<RecommendationCardProps>(
  ({ ctaKey, descriptionKey, i18nValues, icon, onAction, tagKey, titleKey }) => {
    const { t } = useTranslation('home');
    const { message } = App.useApp();
    const [loading, setLoading] = useState(false);

    const title = t(titleKey, { defaultValue: '', ...i18nValues });
    const description = t(descriptionKey, { defaultValue: '', ...i18nValues });
    const ctaLabel = t(ctaKey, { defaultValue: '', ...i18nValues });
    const tagLabel = tagKey ? t(tagKey, { defaultValue: '', ...i18nValues }) : '';

    const handleClick = useCallback(async () => {
      if (loading) return;
      setLoading(true);
      try {
        await onAction();
      } catch (error) {
        console.error('[recommendations] action failed:', error);
        message.error(t('common.error', { defaultValue: 'Something went wrong' }));
      } finally {
        setLoading(false);
      }
    }, [loading, message, onAction, t]);

    return (
      <Block
        className={cx(briefStyles.card, styles.card)}
        gap={12}
        padding={12}
        style={{ borderRadius: cssVar.borderRadiusLG }}
        variant={'outlined'}
      >
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
          >
            {icon}
            <Text ellipsis fontSize={16} weight={500}>
              {title}
            </Text>
          </Flexbox>
        </Flexbox>
        <Divider dashed style={{ marginBlock: 0 }} />
        {description.trim().length > 0 ? <BriefCardSummary summary={description} /> : null}
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            {tagLabel ? (
              <Tag size={'small'} variant={'outlined'}>
                {tagLabel}
              </Tag>
            ) : null}
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8}>
            <Button
              shadow
              className={briefStyles.actionBtnPrimary}
              loading={loading}
              shape={'round'}
              onClick={handleClick}
            >
              {ctaLabel}
            </Button>
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

RecommendationCard.displayName = 'RecommendationCard';
