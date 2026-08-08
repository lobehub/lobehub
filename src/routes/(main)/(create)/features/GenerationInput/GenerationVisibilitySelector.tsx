'use client';

import { Block, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
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

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    flex-shrink: 0;

    min-width: 76px;
    max-width: 128px;
    height: 36px;

    white-space: nowrap;
  `,
  label: css`
    overflow: hidden;

    min-width: 0;

    font-size: 14px;
    line-height: 1;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

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
          className={styles.chip}
          gap={6}
          paddingBlock={4}
          paddingInline={10}
          variant={'borderless'}
        >
          <Icon color={cssVar.colorTextDescription} icon={IconComp} size={14} />
          <span className={styles.label}>{label}</span>
        </Block>
      </TaskVisibilityTag>
    );
  },
);

GenerationVisibilitySelector.displayName = 'GenerationVisibilitySelector';

export default GenerationVisibilitySelector;
