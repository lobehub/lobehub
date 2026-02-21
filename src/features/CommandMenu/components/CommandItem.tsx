import { Command } from 'cmdk';
import { type ComponentProps, type ReactNode } from 'react';
import { cloneElement, isValidElement, memo } from 'react';

import { useCommandMenuContext } from '../CommandMenuContext';
import { styles } from '../styles';

type BaseCommandItemProps = Omit<ComponentProps<typeof Command.Item>, 'children' | 'title'> & {
  /**
   * Hide the item from default view but keep it searchable
   * When true, the item won't show in the default list but will appear in search results
   */
  unpinned?: boolean;
};

type SimpleCommandItemProps = BaseCommandItemProps & {
  children: ReactNode;
  icon: ReactNode;
  variant?: 'simple';
};

type DetailedCommandItemProps = BaseCommandItemProps & {
  description?: ReactNode;
  icon: ReactNode;
  title: ReactNode;
  trailingLabel?: ReactNode;
  variant: 'detailed';
};

type CommandItemProps = SimpleCommandItemProps | DetailedCommandItemProps;

/**
 * Wrapper component for Command.Item that centralizes style management
 */
const CommandItem = memo<CommandItemProps>((props) => {
  const { search } = useCommandMenuContext();

  // Check if item should be rendered
  // Unpinned items are only rendered when there's an active search
  const shouldRender = props.unpinned ? !!search : true;

  if (!shouldRender) {
    return null;
  }

  if (props.variant === 'detailed') {
    const { icon, title, description, trailingLabel, unpinned: _unpinned, ...itemProps } = props;
    return (
      <Command.Item {...itemProps}>
        <div className={styles.itemContent}>
          <div className={styles.itemIcon}>{icon}</div>
          <div className={styles.itemDetails}>
            <div className={styles.itemTitle}>{title}</div>
            {description && <div className={styles.itemDescription}>{description}</div>}
          </div>
          {trailingLabel && <div className={styles.itemType}>{trailingLabel}</div>}
        </div>
      </Command.Item>
    );
  }

  // Simple variant (default)

  const { icon, children, unpinned: _unpinned, ...itemProps } = props;

  // Clone the icon element and add the icon className if it's a valid React element
  const iconWithClass =
    isValidElement(icon) && typeof icon.type !== 'string'
      ? cloneElement(icon, { className: styles.icon } as never)
      : icon;

  return (
    <Command.Item {...itemProps}>
      {iconWithClass}
      <div className={styles.itemContent}>
        <div className={styles.itemLabel}>{children}</div>
      </div>
    </Command.Item>
  );
});

CommandItem.displayName = 'CommandItem';

export default CommandItem;
