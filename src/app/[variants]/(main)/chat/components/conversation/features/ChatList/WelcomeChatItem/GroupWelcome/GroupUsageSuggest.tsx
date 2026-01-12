'use client';

import { ActionIcon, Block, Grid, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { shuffle } from 'lodash-es';
import { RefreshCw } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { TFunction, useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useSendGroupMessage } from '../../../ChatInput/useSend';
import { useTemplateMatching } from './useTemplateMatching';

const useStyles = createStyles(({ css, token, responsive }) => ({
  card: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    height: 100%;
    min-height: 110px;
    padding: 16px;
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorBgContainer};

    transition: all ${token.motionDurationMid};

    &:hover {
      border-color: ${token.colorPrimary};
      box-shadow: 0 2px 8px ${token.colorPrimaryBg};
    }

    ${responsive.mobile} {
      min-height: 72px;
    }
  `,
  cardDesc: css`
    margin-block: 0 !important;
    color: ${token.colorTextDescription};
  `,
  cardTitle: css`
    margin-block: 0 !important;
    font-size: 16px;
    font-weight: bold;
  `,
  emoji: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${token.borderRadius}px;

    font-size: 24px;

    background: ${token.colorFillTertiary};
  `,
  title: css`
    color: ${token.colorTextDescription};
  `,
}));

// Get fallback activities from general section
const getFallbackActivities = (t: TFunction) => {
  const generalActivities = t('guide.groupActivities.general', { returnObjects: true }) as Record<
    string,
    { description: string; emoji: string; prompt: string; title: string }
  >;
  return generalActivities || {};
};

const GroupUsageSuggest = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('welcome');
  const { styles } = useStyles();
  const { updateMessageInput, send } = useSendGroupMessage();
  const templateMatch = useTemplateMatching();

  const itemsPerPage = mobile ? 2 : 4;

  // Use template-specific activities if available, otherwise use fallback
  const availableActivities = useMemo(() => {
    if (templateMatch?.activities && Object.keys(templateMatch.activities).length > 0) {
      return templateMatch.activities;
    }
    return getFallbackActivities(t);
  }, [templateMatch?.templateId, t]); // Use templateId instead of activities to prevent object reference issues

  const activityKeys = useMemo(() => Object.keys(availableActivities), [availableActivities]);
  const [shuffledActivityKeys, setShuffledActivityKeys] = useState<string[]>([]);

  // Initialize shuffled activities only once when activityKeys change
  useEffect(() => {
    if (activityKeys.length > 0) {
      setShuffledActivityKeys(shuffle([...activityKeys]));
    }
  }, [activityKeys]);

  const displayedActivityKeys = shuffledActivityKeys.slice(0, itemsPerPage);

  const handleRefresh = () => {
    if (activityKeys.length > 0) {
      setShuffledActivityKeys(shuffle([...activityKeys]));
    }
  };

  // Don't render if no activities available or not yet initialized
  if (!activityKeys.length || !shuffledActivityKeys.length) {
    return null;
  }

  return (
    <Flexbox gap={8} width={'100%'}>
      <Flexbox align={'center'} horizontal justify={'space-between'}>
        <div className={styles.title}>{t('guide.groupActivities.title')}</div>
        <ActionIcon
          icon={RefreshCw}
          onClick={handleRefresh}
          size={{ blockSize: 24, size: 14 }}
          title="Show more activities"
        />
      </Flexbox>
      <Grid gap={8} rows={2}>
        {displayedActivityKeys.map((activityKey) => {
          const activity = availableActivities[activityKey];
          if (!activity) return null;

          const { title, emoji, description, prompt } = activity;

          return (
            <Block
              className={styles.card}
              clickable
              gap={12}
              horizontal
              key={activityKey}
              onClick={() => {
                updateMessageInput(prompt);
                send();
              }}
              variant={'outlined'}
            >
              <div className={styles.emoji}>{emoji}</div>
              <Flexbox gap={2} style={{ overflow: 'hidden', width: '100%' }}>
                <Text className={styles.cardTitle} ellipsis={{ rows: 1 }}>
                  {title}
                </Text>
                <Text className={styles.cardDesc} ellipsis={{ rows: mobile ? 1 : 2 }}>
                  {description}
                </Text>
              </Flexbox>
            </Block>
          );
        })}
      </Grid>
    </Flexbox>
  );
});

export default GroupUsageSuggest;
