'use client';

import { Block, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ListChecksIcon } from 'lucide-react';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';

import type { Plan } from '../../../types';

const MAX_CONTENT_HEIGHT = 100;

const useStyles = createStyles(({ css, token }) => ({
  content: css`
    overflow: hidden auto;

    max-height: ${MAX_CONTENT_HEIGHT}px;
    padding: 12px;
    border-radius: ${token.borderRadius}px;

    background: ${token.colorFillQuaternary};
  `,
  header: css`
    cursor: pointer;
    padding-block: 4px;
    padding-inline: 0;
    transition: opacity 0.2s;

    &:hover {
      opacity: 0.8;
    }
  `,
}));

interface PlanCardProps {
  plan: Plan;
}

const PlanCard = memo<PlanCardProps>(({ plan }) => {
  const { styles } = useStyles();
  const openDocument = useChatStore((s) => s.openDocument);

  const handleHeaderClick = () => {
    openDocument(plan.id);
  };

  const hasContext = !!plan.context;

  return (
    <Block gap={8} padding={12} style={{ overflow: 'hidden' }} variant={'outlined'}>
      {/* Header - clickable to open document */}
      <Flexbox
        horizontal
        align={'center'}
        className={styles.header}
        gap={8}
        style={{ overflow: 'hidden' }}
        onClick={handleHeaderClick}
      >
        <Icon icon={ListChecksIcon} size={18} />
        <Text ellipsis fontSize={16} weight={500}>
          {plan.goal}
        </Text>
      </Flexbox>

      {/* Description */}
      {plan.description && (
        <Text ellipsis={{ rows: 2 }} fontSize={14} type={'secondary'}>
          {plan.description}
        </Text>
      )}

      {/* Context content */}
      {hasContext && (
        <div className={styles.content}>
          <Markdown fontSize={13} variant={'chat'}>
            {plan.context!}
          </Markdown>
        </div>
      )}
    </Block>
  );
});

export default PlanCard;
