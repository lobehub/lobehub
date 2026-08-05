import { Block, Flexbox, Tag, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { cssVar, cx } from 'antd-style';
import { memo, type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BriefCardSummary from '@/features/DailyBrief/BriefCardSummary';
import { styles as briefStyles } from '@/features/DailyBrief/style';
import { homeType } from '@/features/Home/components/homeType';

import { styles } from './style';

interface RecommendationCardProps {
  /** Rail rendering: one scannable line, the CTA is the row itself. */
  compact?: boolean;
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
  ({ compact, ctaKey, descriptionKey, i18nValues, icon, onAction, tagKey, titleKey }) => {
    const { t } = useTranslation('home');

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
        toast.error(t('common.error', { defaultValue: 'Something went wrong' }));
      } finally {
        setLoading(false);
      }
    }, [loading, onAction, t]);

    if (compact)
      return (
        <Button className={styles.compactRow} loading={loading} type={'text'} onClick={handleClick}>
          <Flexbox horizontal align={'flex-start'} gap={10} style={{ width: '100%' }}>
            <Flexbox flex={'none'} paddingBlock={2}>
              {icon}
            </Flexbox>
            <Text className={cx(homeType.itemTitleProse, styles.compactTitle)} style={{ flex: 1 }}>
              {title}
            </Text>
          </Flexbox>
        </Button>
      );

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
