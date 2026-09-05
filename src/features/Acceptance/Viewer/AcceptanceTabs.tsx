'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ListChecks, Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type AcceptanceTabKey = 'checks' | 'resources';

interface AcceptanceTabsProps {
  active: AcceptanceTabKey;
  checkCount: number;
  onChange: (key: AcceptanceTabKey) => void;
  resourceCount: number;
}

const styles = createStaticStyles(({ css }) => ({
  count: css`
    padding-block: 0;
    padding-inline: 6px;
    border-radius: 99px;

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  tab: css`
    cursor: pointer;

    position: relative;

    padding-block: 8px;
    padding-inline: 10px;

    white-space: nowrap;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  tabActive: css`
    &::after {
      content: '';

      position: absolute;
      inset-block-end: -1px;
      inset-inline: 6px;

      block-size: 2px;
      border-radius: 2px;

      background: ${cssVar.colorPrimary};
    }
  `,
}));

/**
 * The delivery's two faces: the checks a person judges, and the artefacts the
 * rounds produced. They sit above the full-width rule so the rule reads as the
 * boundary between "what this delivery is" and "what you are looking at".
 */
const AcceptanceTabs = ({ active, checkCount, onChange, resourceCount }: AcceptanceTabsProps) => {
  const { t } = useTranslation('verify');
  const tabs = [
    {
      count: checkCount,
      icon: ListChecks,
      key: 'checks' as const,
      label: t('acceptance.tabs.checks'),
    },
    {
      count: resourceCount,
      icon: Paperclip,
      key: 'resources' as const,
      label: t('acceptance.tabs.resources'),
    },
  ];

  return (
    <Flexbox horizontal align={'center'} gap={2}>
      {tabs.map((tab) => (
        <Flexbox
          horizontal
          align={'center'}
          className={cx(styles.tab, tab.key === active && styles.tabActive)}
          gap={6}
          key={tab.key}
          onClick={() => onChange(tab.key)}
        >
          <Icon icon={tab.icon} size={14} style={{ color: cssVar.colorTextTertiary }} />
          <Text fontSize={13} weight={tab.key === active ? 600 : 400}>
            {tab.label}
          </Text>
          <Text className={styles.count}>{tab.count}</Text>
        </Flexbox>
      ))}
    </Flexbox>
  );
};

export default AcceptanceTabs;
