import { type DropdownItem } from '@lobehub/ui/base-ui';

/**
 * What a portal can do with the entity it shows. Every field is optional: a
 * capability the portal does not declare is simply absent from the menu —
 * never rendered disabled.
 */
export interface PortalMoreMenuConfig {
  /** Copy the entity id verbatim. */
  copyId?: string;
  /** Absolute shareable URL of the entity; the menu copies it and confirms. */
  copyLink?: string;
  /**
   * Copy the entity's file path — for entities addressed by a path instead of
   * an id (local files).
   */
  copyPath?: string;
  /**
   * Delete the entity. The portal owns the confirmation dialog and what
   * happens to the panel afterwards.
   */
  delete?: () => void;
  /** Portal-specific actions, rendered as their own group before delete. */
  extraItems?: DropdownItem[];
  /** Leave the panel for the entity's full page. */
  openInPage?: () => void;
  /** Refetch the entity from the server. */
  refresh?: () => unknown;
  /** Start renaming the entity (inline edit or a rename modal). */
  rename?: () => void;
}

/** Declared on `PortalImpl.useMoreMenu`; returning `undefined` hides the menu. */
export type UsePortalMoreMenu = () => PortalMoreMenuConfig | undefined;
