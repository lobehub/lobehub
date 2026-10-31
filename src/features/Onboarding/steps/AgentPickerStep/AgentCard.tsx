import type { AgentTemplate } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { Avatar, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
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
      {...stylex.props(styles.card, selected && styles.cardSelected)}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <Avatar avatar={template.avatar} shape="square" size={36} />
      <div {...stylex.props(styles.cardBody)}>
        <div {...stylex.props(styles.cardTitle)}>{template.title}</div>
        {template.description && (
          <div {...stylex.props(styles.cardDescription)}>{template.description}</div>
        )}
      </div>
      <Icon
        className={stylex.props(styles.cardCheck, !selected && styles.cardCheckHidden).className}
        icon={CheckIcon}
        size={16}
      />
    </div>
  );
});

AgentCard.displayName = 'AgentCard';

export default AgentCard;
