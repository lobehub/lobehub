/**
 * A workspace member's own display settings (`workspace_members.config`),
 * kept with their membership so they go when the member leaves. Absent keys
 * mean the default.
 */
export interface WorkspaceMemberConfig {
  /** The color the member picked for their profile card, `#rrggbb`. */
  badgeColor?: string;
}
