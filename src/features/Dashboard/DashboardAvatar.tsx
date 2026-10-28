import { Avatar } from '@lobehub/ui';

export interface DashboardAvatarProps {
  /** The board's own icon (an emoji or image URL), when it has one. */
  icon?: string | null;
  size?: number;
  title: string;
}

/**
 * A board's icon, or the ring-style avatar `@lobehub/ui` generates from its
 * name when it has none, so every board is told apart at a glance.
 */
const DashboardAvatar = ({ icon, size = 20, title }: DashboardAvatarProps) => (
  <Avatar
    avatar={icon || undefined}
    fallbackVariant={'ring'}
    shape={'square'}
    size={size}
    style={{ flex: 'none' }}
    title={title}
  />
);

export default DashboardAvatar;
