'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Tabs, Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ListChecks, MessagesSquare, Paperclip, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type AcceptanceTabKey = 'checks' | 'discussion' | 'resources' | 'flow';

const styles = createStaticStyles(({ css }) => ({
  // The square variant underlines its whole list; the band below already draws
  // the full-width rule, so the list's own line would sit on top of it.
  list: css`
    && {
      box-shadow: none;
    }
  `,
}));

interface AcceptanceTabsProps {
  active: AcceptanceTabKey;
  checkCount: number;
  /** Open discussion threads on this delivery. */
  discussionCount: number;
  flowCount?: number;
  onChange: (key: AcceptanceTabKey) => void;
  resourceCount: number;
}

/**
 * The delivery's faces: the conversation about it, the checks a person judges,
 * and the artefacts the rounds produced. They close the identity band; the
 * active tab's underline is the boundary between "what this delivery is" and
 * "what you are looking at".
 *
 * Discussion leads, as GitHub's Conversation does — it is the delivery's
 * shared thread, and it was unfindable while it sat below the checklist.
 */
const AcceptanceTabs = ({
  active,
  checkCount,
  discussionCount,
  flowCount = 0,
  onChange,
  resourceCount,
}: AcceptanceTabsProps) => {
  const { t } = useTranslation('verify');
  const tabs = [
    {
      count: discussionCount,
      icon: MessagesSquare,
      key: 'discussion' as const,
      label: t('acceptance.comments.title'),
    },
    {
      count: checkCount,
      icon: ListChecks,
      key: 'checks' as const,
      label: t('acceptance.tabs.checks'),
    },
    { count: flowCount, icon: Route, key: 'flow' as const, label: t('flow.title') },
    {
      count: resourceCount,
      icon: Paperclip,
      key: 'resources' as const,
      label: t('acceptance.tabs.resources'),
    },
  ];

  return (
    <Tabs
      activeKey={active}
      classNames={{ list: styles.list }}
      style={{ minWidth: 0, overflowX: 'auto' }}
      variant={'square'}
      items={tabs
        .filter((tab) => tab.key !== 'flow' || flowCount > 0)
        .map((tab) => ({
          icon: <Icon icon={tab.icon} size={16} />,
          key: tab.key,
          label: (
            <Flexbox horizontal align={'center'} gap={6}>
              {tab.label}
              <Tag shape={'round'}>{tab.count}</Tag>
            </Flexbox>
          ),
        }))}
      onChange={(key) => onChange(key as AcceptanceTabKey)}
    />
  );
};

export default AcceptanceTabs;
