import type { AgentTemplate } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { Avatar, Icon } from '@lobehub/ui';
import { cx } from 'antd-style';
import { CheckIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { memo, useCallback } from 'react';

import { styles } from './style';

interface AgentCardProps {
  onToggle: (id: string) => void;
  selected: boolean;
  template: AgentTemplate;
}

const AgentCard = memo<AgentCardProps>(({ onToggle, selected, template }) => {
  const handleClick = useCallback(() => onToggle(template.id), [onToggle, template.id]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onToggle(template.id);
      }
    },
    [onToggle, template.id],
  );

  return (
    <div
      aria-pressed={selected}
      className={cx(styles.card, selected && styles.cardSelected)}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <Avatar avatar={template.avatar} shape="square" size={36} />
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>{template.title}</div>
        {template.description && (
          <div className={styles.cardDescription}>{template.description}</div>
        )}
      </div>
      <Icon
        className={cx(styles.cardCheck, !selected && styles.cardCheckHidden)}
        icon={CheckIcon}
        size={16}
      />
    </div>
  );
});

AgentCard.displayName = 'AgentCard';

export default AgentCard;
