'use client';

import type { GithubIntegrationPreference } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { Switch, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding-block: 4px;
    padding-inline: 16px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  row: css`
    padding-block: 14px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
}));

type SwitchKey = keyof GithubIntegrationPreference;

const SWITCHES: SwitchKey[] = ['acceptOnMerge', 'wakeOnCiFailure', 'wakeOnReview'];

/**
 * What LobeHub does on its own when GitHub reports activity. Every switch
 * is on unless the user turned it off; the server reads the same
 * preference before acting, so a switch here is the whole opt-out.
 */
const Automation = memo(() => {
  const { t } = useTranslation('integration');
  const [isPreferenceInit, preference, updatePreference] = useUserStore((s) => [
    preferenceSelectors.isPreferenceInit(s),
    s.preference.integration?.github,
    s.updatePreference,
  ]);

  const toggle = (key: SwitchKey, next: boolean) =>
    updatePreference({ integration: { github: { ...preference, [key]: next } } });

  return (
    <Flexbox gap={12}>
      <Flexbox gap={4}>
        <Text strong style={{ fontSize: 15 }}>
          {t('github.automation.title')}
        </Text>
        <Text style={{ fontSize: 13 }} type="secondary">
          {t('github.automation.description')}
        </Text>
      </Flexbox>
      <Block className={styles.card} variant={'outlined'}>
        {SWITCHES.map((key) => (
          <Flexbox horizontal align="center" className={styles.row} gap={24} key={key}>
            <Flexbox flex={1} gap={2}>
              <Text strong>{t(`github.automation.${key}.title`)}</Text>
              <Text style={{ fontSize: 13 }} type="secondary">
                {t(`github.automation.${key}.description`)}
              </Text>
            </Flexbox>
            <Switch
              checked={preference?.[key] !== false}
              loading={!isPreferenceInit}
              onChange={(next: boolean) => toggle(key, next)}
            />
          </Flexbox>
        ))}
      </Block>
    </Flexbox>
  );
});

Automation.displayName = 'GithubIntegrationAutomation';

export default Automation;
