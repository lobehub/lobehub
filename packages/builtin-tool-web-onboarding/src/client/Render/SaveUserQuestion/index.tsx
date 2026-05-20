'use client';

import type { InterestAreaKey } from '@lobechat/const';
import type { BuiltinRenderProps, SaveUserQuestionInput } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  avatar: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    box-sizing: border-box;
    width: 48px;
    height: 48px;
    border-radius: 16px;

    font-size: 28px;
    line-height: 1;

    background: ${cssVar.colorFillQuaternary};
  `,
  chip: css`
    display: inline-flex;
    align-items: center;

    padding-block: 4px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};
  `,
  detailCard: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorFillTertiary};
  `,
  name: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  sectionLabel: css`
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
  `,
  value: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: 10px;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};
  `,
}));

const SaveUserQuestion = memo<BuiltinRenderProps<SaveUserQuestionInput, unknown, unknown>>(
  ({ args }) => {
    const { t } = useTranslation('plugin');
    const { t: tOnboarding } = useTranslation('onboarding');

    const agentName = args?.agentName?.trim();
    const agentEmoji = args?.agentEmoji?.trim();
    const fullName = args?.fullName?.trim();
    const interestLabels = useMemo(() => {
      const predefined = (args?.interests ?? []).map((key) =>
        tOnboarding(`interests.area.${key as InterestAreaKey}`),
      );
      const custom = (args?.customInterests ?? [])
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      return [...predefined, ...custom];
    }, [args?.interests, args?.customInterests, tOnboarding]);

    const hasAgentIdentity = Boolean(agentName || agentEmoji);
    const hasUserProfile = Boolean(fullName);
    const hasInterests = interestLabels.length > 0;

    if (!hasAgentIdentity && !hasUserProfile && !hasInterests) return null;

    return (
      <Flexbox gap={16}>
        {hasAgentIdentity && (
          <Flexbox gap={8}>
            <Text className={styles.sectionLabel}>
              {t('builtins.lobe-web-onboarding.render.agent')}
            </Text>
            <div className={styles.detailCard}>
              <Flexbox horizontal align="center" gap={12}>
                <div className={styles.avatar}>{agentEmoji || '🤖'}</div>
                {agentName && <div className={styles.name}>{agentName}</div>}
              </Flexbox>
            </div>
          </Flexbox>
        )}

        {hasUserProfile && (
          <Flexbox gap={8}>
            <Text className={styles.sectionLabel}>
              {t('builtins.lobe-web-onboarding.render.fullName')}
            </Text>
            <div className={styles.detailCard}>
              <div className={styles.value}>{fullName}</div>
            </div>
          </Flexbox>
        )}

        {hasInterests && (
          <Flexbox gap={8}>
            <Text className={styles.sectionLabel}>
              {t('builtins.lobe-web-onboarding.render.interests')}
            </Text>
            <Flexbox horizontal style={{ flexWrap: 'wrap', gap: 8 }}>
              {interestLabels.map((label) => (
                <span className={styles.chip} key={label}>
                  {label}
                </span>
              ))}
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

SaveUserQuestion.displayName = 'WebOnboardingSaveUserQuestion';

export default SaveUserQuestion;
