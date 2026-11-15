export interface ProjectAvatarSource {
  /** The project's logo: an emoji or image URL. */
  avatar?: string | null;
  /**
   * Seed of the generated avatar: the project id, so renaming a project keeps
   * its avatar. The create modal passes the id it reserved for the project.
   */
  id: string;
  name: string;
}

/**
 * `@lobehub/ui`'s Avatar seeds its generated gradient from `title`, so the id
 * goes there and the name only labels the avatar through `alt`.
 */
export const toProjectAvatarProps = ({ avatar, id, name }: ProjectAvatarSource) => ({
  alt: name,
  avatar: avatar || undefined,
  title: id,
});
