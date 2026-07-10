import { Block, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { LockIcon, UsersIcon } from 'lucide-react';
import { type ComponentProps, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getTaskVisibilityDefaultLabel, getTaskVisibilityLabelKey } from './taskVisibilityLabel';

type BlockProps = ComponentProps<typeof Block>;

interface TaskVisibilityChipLabelProps extends Omit<BlockProps, 'children' | 'variant'> {
  /** Render mode: 'chip' shows the [icon + text] pill used in create forms;
   *  'tag' shows a tighter [icon + text] used in the detail panel. They only
   *  differ in spacing. */
  variant?: 'chip' | 'tag';
  visibility: 'private' | 'public';
}

/**
 * Shared chip body for the visibility tag: lock/users icon + localized label.
 * Three call sites (`CreateTaskContent`, `CreateTaskInlineEntry`,
 * `TaskProperties`) used to inline this same JSX; centralizing keeps the
 * icon/label mapping in one place when we add new visibility values later.
 *
 * Extra props and `ref` are forwarded to the underlying `Block` so that when
 * this component is used as the `DropdownMenu` trigger inside
 * `TaskVisibilityTag`, the menu's click/aria/ref props reach a real DOM node.
 */
const TaskVisibilityChipLabel = memo<TaskVisibilityChipLabelProps>(
  ({ variant = 'chip', visibility, ...rest }) => {
    const { t } = useTranslation('chat');
    const IconComp = visibility === 'private' ? LockIcon : UsersIcon;
    const label = t(getTaskVisibilityLabelKey(visibility) as never, {
      defaultValue: getTaskVisibilityDefaultLabel(visibility),
    });

    const iconColor = variant === 'tag' ? cssVar.colorTextSecondary : cssVar.colorTextDescription;
    const iconSize = variant === 'tag' ? 16 : 14;

    return (
      <Block
        clickable
        horizontal
        align="center"
        gap={variant === 'tag' ? 10 : 6}
        paddingBlock={4}
        paddingInline={8}
        variant={'borderless'}
        {...rest}
      >
        <Icon color={iconColor} icon={IconComp} size={iconSize} />
        {variant === 'tag' ? <Text weight={500}>{label}</Text> : <Text fontSize={12}>{label}</Text>}
      </Block>
    );
  },
);

TaskVisibilityChipLabel.displayName = 'TaskVisibilityChipLabel';

export default TaskVisibilityChipLabel;
