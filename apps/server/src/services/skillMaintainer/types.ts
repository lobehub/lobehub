/** Scope where a managed skill currently lives. */
export type ManagedSkillScope = 'agent' | 'builtin' | 'installed';

/**
 * Reference to a skill package resolved from an external skill identifier.
 */
export interface ManagedSkillReference {
  /** Stable skill or document id. */
  id: string;
  /** Backing source for package reads and writes. */
  kind: 'agent-skill' | 'builtin' | 'installed';
  /** VFS root path for the package. */
  rootPath: string;
  /** Lifecycle scope used by policy checks. */
  scope: ManagedSkillScope;
  /** Whether package content can be mutated directly. */
  writable: boolean;
}
