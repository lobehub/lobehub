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
    padding-inline: 20px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  row: css`
    padding-block: 16px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
}));

type SwitchKey = keyof GithubIntegrationPreference;

interface SwitchGroup {
  /** Switches whose absent value means on; the rest default to off. */
  defaultOn: SwitchKey[];
  id: 'automation' | 'comments';
  keys: SwitchKey[];
}

const GROUPS: SwitchGroup[] = [
  {
    defaultOn: ['acceptOnMerge', 'wakeOnCiFailure', 'wakeOnReview'],
    id: 'automation',
    keys: ['acceptOnMerge', 'wakeOnCiFailure', 'wakeOnReview'],
  },
  {
    defaultOn: ['commentOnPrivateRepositories'],
    id: 'comments',
    keys: ['commentOnPrivateRepositories', 'commentOnPublicRepositories'],
  },
];

/**
 * What LobeHub does on its own when GitHub reports activity, and what it
 * writes back. The server reads the same preference before acting, so a
 * switch here is the whole opt-out (or opt-in, for public-repo comments).
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
    <>
      {GROUPS.map((group) => (
        <Flexbox gap={12} key={group.id}>
          <Flexbox gap={4}>
            <Text strong style={{ fontSize: 16 }}>
              {t(`github.${group.id}.title`)}
            </Text>
            <Text type="secondary">{t(`github.${group.id}.description`)}</Text>
          </Flexbox>
          <Block className={styles.card} variant={'filled'}>
            {group.keys.map((key) => {
              const checked = group.defaultOn.includes(key)
                ? preference?.[key] !== false
                : preference?.[key] === true;
              return (
                <Flexbox horizontal align="center" className={styles.row} gap={24} key={key}>
                  <Flexbox flex={1} gap={2}>
                    <Text strong>{t(`github.${group.id}.${key}.title` as any)}</Text>
                    <Text style={{ fontSize: 13 }} type="secondary">
                      {t(`github.${group.id}.${key}.description` as any)}
                    </Text>
                  </Flexbox>
                  <Switch
                    checked={checked}
                    loading={!isPreferenceInit}
                    onChange={(next: boolean) => toggle(key, next)}
                  />
                </Flexbox>
              );
            })}
          </Block>
        </Flexbox>
      ))}
    </>
  );
});

Automation.displayName = 'GithubIntegrationAutomation';

export default Automation;
