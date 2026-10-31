'use client';

import type { InterestAreaKey } from '@lobechat/const';
import type { BuiltinRenderProps, SaveUserQuestionInput } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  avatar: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    width: '48px',
    height: '48px',
    borderRadius: '16px',
    fontSize: '28px',
    lineHeight: 1,
    background: cssVar.colorFillQuaternary,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    paddingBlock: '4px',
    paddingInline: '10px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    background: cssVar.colorFillQuaternary,
  },
  detailCard: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    background: cssVar.colorFillTertiary,
  },
  name: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    fontSize: '16px',
    fontWeight: 600,
    color: cssVar.colorText,
  },
  sectionLabel: { fontSize: '12px', fontWeight: 600, color: cssVar.colorTextSecondary },
  value: { fontSize: '14px', fontWeight: 500, color: cssVar.colorText },
});

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
            <Text className={stylex.props(styles.sectionLabel).className}>
              {t('builtins.lobe-web-onboarding.render.agent')}
            </Text>
            <div {...stylex.props(styles.detailCard)}>
              <Flexbox horizontal align="center" gap={12}>
                <div {...stylex.props(styles.avatar)}>{agentEmoji || '🤖'}</div>
                {agentName && <div {...stylex.props(styles.name)}>{agentName}</div>}
              </Flexbox>
            </div>
          </Flexbox>
        )}

        {hasUserProfile && (
          <Flexbox gap={8}>
            <Text className={stylex.props(styles.sectionLabel).className}>
              {t('builtins.lobe-web-onboarding.render.fullName')}
            </Text>
            <div {...stylex.props(styles.detailCard)}>
              <div {...stylex.props(styles.value)}>{fullName}</div>
            </div>
          </Flexbox>
        )}

        {hasInterests && (
          <Flexbox gap={8}>
            <Text className={stylex.props(styles.sectionLabel).className}>
              {t('builtins.lobe-web-onboarding.render.interests')}
            </Text>
            <Flexbox horizontal style={{ flexWrap: 'wrap', gap: 8 }}>
              {interestLabels.map((label) => (
                <span {...stylex.props(styles.chip)} key={label}>
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
