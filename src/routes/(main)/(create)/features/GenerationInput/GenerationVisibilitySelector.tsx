'use client';

import { Block, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LockIcon, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getTaskVisibilityDefaultLabel,
  getTaskVisibilityLabelKey,
} from '@/features/AgentTasks/features/taskVisibilityLabel';
import TaskVisibilityTag from '@/features/AgentTasks/features/TaskVisibilityTag';

interface GenerationVisibilitySelectorProps {
  disabledReason?: string;
  onChange: (visibility: 'private' | 'public') => void;
  visibility: 'private' | 'public';
}

const styles = stylex.create({
  chip: {
    flexShrink: 0,
    minWidth: '76px',
    maxWidth: '128px',
    height: '36px',
    whiteSpace: 'nowrap',
  },
  label: {
    overflow: 'hidden',
    minWidth: '0',
    fontSize: '14px',
    lineHeight: 1,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const GenerationVisibilitySelector = memo<GenerationVisibilitySelectorProps>(
  ({ disabledReason, onChange, visibility }) => {
    const { t } = useTranslation('chat');
    const IconComp = visibility === 'private' ? LockIcon : UsersIcon;
    const label = t(getTaskVisibilityLabelKey(visibility) as never, {
      defaultValue: getTaskVisibilityDefaultLabel(visibility),
    });

    return (
      <TaskVisibilityTag lockedReason={disabledReason} visibility={visibility} onChange={onChange}>
        <Block
          clickable
          horizontal
          align="center"
          className={stylex.props(styles.chip).className}
          gap={6}
          paddingBlock={4}
          paddingInline={10}
          variant={'borderless'}
        >
          <Icon color={cssVar.colorTextDescription} icon={IconComp} size={14} />
          <span {...stylex.props(styles.label)}>{label}</span>
        </Block>
      </TaskVisibilityTag>
    );
  },
);

GenerationVisibilitySelector.displayName = 'GenerationVisibilitySelector';

export default GenerationVisibilitySelector;
