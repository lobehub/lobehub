'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

const styles = stylex.create({
  body: {
    paddingBlock: 12,
    paddingInline: 16,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  clickable: {
    cursor: 'pointer',
  },
  container: {
    width: 300,
    maxWidth: 'calc(100vw - 48px)',
    backgroundColor: cssVar.colorBgElevated,
  },
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    fontSize: 13,
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  header: {
    padding: 16,
  },
  headerText: {
    flex: '1',
    minWidth: 0,
  },
  row: {
    minWidth: 0,
    fontSize: 13,
    lineHeight: '20px',
    color: cssVar.colorText,
  },
  rowIcon: {
    flex: 'none',
    height: 20,
    color: cssVar.colorTextTertiary,
  },
  rowValue: {
    flex: '1',
    minWidth: 0,
  },
  subtitle: {
    fontSize: 13,
    color: cssVar.colorTextTertiary,
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: cssVar.colorText,
  },
  titleHover: {
    color: {
      'default': cssVar.colorText,
      ':hover': cssVar.colorPrimary,
    },
  },
});

const cls = (...style: stylex.StyleXStyles[]) => stylex.props(...style).className;

/**
 * A hover card renders in a portal, but React still bubbles its clicks to the
 * trigger's ancestors: without stopping them, clicking inside the card would
 * also open the assignee picker or the row the avatar sits in.
 */
export const stopCardClick = (event: { stopPropagation: () => void }) => event.stopPropagation();

interface ProfileHoverCardRowProps {
  children: ReactNode;
  icon: LucideIcon;
  /** Names the row for assistive tech; rows show only their value, like an issue tracker's. */
  label: string;
}

export const ProfileHoverCardRow = memo<ProfileHoverCardRowProps>(({ icon, label, children }) => (
  <Flexbox horizontal align={'flex-start'} aria-label={label} className={cls(styles.row)} gap={10}>
    <Center className={cls(styles.rowIcon)}>
      <Icon icon={icon} size={15} />
    </Center>
    <div {...stylex.props(styles.rowValue)}>{children}</div>
  </Flexbox>
));

ProfileHoverCardRow.displayName = 'ProfileHoverCardRow';

export interface ProfileHoverCardProps {
  avatar: ReactNode;
  /** Detail rows under the divider; the divider is omitted when empty. */
  children?: ReactNode;
  description?: ReactNode;
  /** Makes the avatar and title open the profile. */
  onHeaderClick?: () => void;
  subtitle?: ReactNode;
  /** What kind of teammate this is (a role, or "Agent"). */
  tag?: ReactNode;
  testId?: string;
  title: string;
}

/**
 * The shared shape of a teammate's hover card, for people and Agents alike:
 * who they are and what they are, then a few facts with icons — the way an
 * issue tracker shows an assignee.
 */
const ProfileHoverCard = memo<ProfileHoverCardProps>(
  ({ avatar, children, description, onHeaderClick, subtitle, tag, testId, title }) => {
    const hasRows = Array.isArray(children) ? children.some(Boolean) : Boolean(children);

    return (
      <Flexbox className={cls(styles.container)} data-testid={testId}>
        <Flexbox className={cls(styles.header)} gap={10}>
          <Flexbox horizontal align={'center'} gap={12}>
            <div
              {...stylex.props(onHeaderClick && styles.clickable)}
              role={onHeaderClick ? 'button' : undefined}
              tabIndex={onHeaderClick ? 0 : undefined}
              onClick={onHeaderClick}
              onKeyDown={
                onHeaderClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') onHeaderClick();
                    }
                  : undefined
              }
            >
              {avatar}
            </div>
            <Flexbox className={cls(styles.headerText)} gap={2}>
              <Flexbox horizontal align={'center'} gap={8}>
                <Text
                  ellipsis
                  className={cls(styles.title, onHeaderClick && styles.titleHover)}
                  style={onHeaderClick ? { cursor: 'pointer' } : undefined}
                  onClick={onHeaderClick}
                >
                  {title}
                </Text>
                {tag}
              </Flexbox>
              {subtitle && (
                <Text ellipsis className={cls(styles.subtitle)}>
                  {subtitle}
                </Text>
              )}
            </Flexbox>
          </Flexbox>
          {description && <div {...stylex.props(styles.description)}>{description}</div>}
        </Flexbox>

        {hasRows && (
          <Flexbox className={cls(styles.body)} gap={8}>
            {children}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

ProfileHoverCard.displayName = 'ProfileHoverCard';

export default ProfileHoverCard;
