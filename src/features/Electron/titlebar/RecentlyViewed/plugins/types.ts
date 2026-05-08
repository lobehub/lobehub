import { type LucideIcon } from 'lucide-react';

import { type LobeDocument } from '@/types/document';
import { type MetaData } from '@/types/meta';
import { type SessionGroupItem } from '@/types/session';
import { type ChatTopic } from '@/types/topic';

import {
  type CachedPageData,
  type PageParamsMap,
  type PageReference,
  type PageType,
  type ResolvedPageData,
} from '../types';

// ======== New Tab Action ======== //

/**
 * Descriptor returned by a plugin to enable the TabBar "+" button
 * for a given active reference.
 */
export interface NewTabAction {
  /**
   * Produce a new PageReference (plus optional cached display data) for
   * a fresh tab in the same context as the active tab. Return null to
   * cancel the creation (e.g. missing prerequisites).
   */
  onCreate: () => Promise<NewTabActionResult | null>;
}

export interface NewTabActionResult {
  cached?: CachedPageData;
  reference: PageReference;
}

// ======== Plugin Context ======== //

/**
 * Context provided to plugins for data access
 * This abstracts away direct store access
 */
export interface PluginContext {
  /**
   * Get agent metadata by ID
   */
  getAgentMeta: (agentId: string) => MetaData | undefined;
  /**
   * Get document by ID
   */
  getDocument: (documentId: string) => LobeDocument | undefined;
  /**
   * Get session/group by ID
   */
  getSessionGroup: (groupId: string) => SessionGroupItem | undefined;
  /**
   * Get topic by ID from current context
   */
  getTopic: (topicId: string) => ChatTopic | undefined;
  /**
   * i18n translation function
   */
  t: (key: string, options?: Record<string, unknown>) => string;
}

// ======== Plugin Interface ======== //

/**
 * Base plugin interface (non-generic for registry use)
 */
export interface BaseRecentlyViewedPlugin {
  /**
   * Check if the underlying data exists
   */
  checkExists: (reference: PageReference, ctx: PluginContext) => boolean;

  /**
   * Build a "new tab" action for the TabBar "+" button. Return null to
   * hide the button when this plugin's reference is active.
   */
  createNewTabAction?: (reference: PageReference, ctx: PluginContext) => NewTabAction | null;

  /**
   * Generate unique ID from reference params
   */
  generateId: (reference: PageReference) => string;

  /**
   * Generate navigation URL from reference
   */
  generateUrl: (reference: PageReference) => string;

  /**
   * Get default icon for this page type
   */
  getDefaultIcon?: () => LucideIcon;

  /**
   * Check if URL matches this plugin
   */
  matchUrl: (pathname: string, searchParams: URLSearchParams) => boolean;

  /**
   * Called when a tab with this reference type is activated.
   * Use to perform store-level state transitions (e.g. switchTopic).
   */
  onActivate?: (reference: PageReference) => void;

  /**
   * Parse URL into a page reference
   */
  parseUrl: (pathname: string, searchParams: URLSearchParams) => PageReference | null;

  /**
   * Priority for URL matching (higher = checked first)
   */
  readonly priority?: number;

  /**
   * Resolve reference into display data
   */
  resolve: (reference: PageReference, ctx: PluginContext) => ResolvedPageData;

  /**
   * Page type this plugin handles
   */
  readonly type: PageType;
}

/**
 * Typed plugin interface for implementation
 * Each page type should have its own plugin implementation
 */
export interface RecentlyViewedPlugin<T extends PageType = PageType> {
  /**
   * Check if the underlying data exists
   * Used to filter out stale entries
   */
  checkExists: (reference: PageReference<T>, ctx: PluginContext) => boolean;

  /**
   * Build a "new tab" action for the TabBar "+" button. Return null to
   * hide the button when this plugin's reference is active.
   */
  createNewTabAction?: (reference: PageReference<T>, ctx: PluginContext) => NewTabAction | null;

  /**
   * Generate unique ID from reference params
   * e.g., "agent:abc123" or "agent-topic:abc123:topic456"
   */
  generateId: (reference: PageReference<T>) => string;

  /**
   * Generate navigation URL from reference
   */
  generateUrl: (reference: PageReference<T>) => string;

  /**
   * Get default icon for this page type
   */
  getDefaultIcon?: () => LucideIcon;

  /**
   * Check if URL matches this plugin
   */
  matchUrl: (pathname: string, searchParams: URLSearchParams) => boolean;

  /**
   * Called when a tab with this reference type is activated.
   * Use to perform store-level state transitions (e.g. switchTopic).
   */
  onActivate?: (reference: PageReference<T>) => void;

  /**
   * Parse URL into a page reference
   * Returns null if URL doesn't match
   */
  parseUrl: (pathname: string, searchParams: URLSearchParams) => PageReference<T> | null;

  /**
   * Priority for URL matching (higher = checked first)
   * Used when multiple plugins could match the same URL
   */
  readonly priority?: number;

  /**
   * Resolve reference into display data
   */
  resolve: (reference: PageReference<T>, ctx: PluginContext) => ResolvedPageData;

  /**
   * Page type this plugin handles
   */
  readonly type: T;
}

// ======== Helper Types ======== //

/**
 * Helper to create typed page reference
 */
export function createPageReference<T extends PageType>(
  type: T,
  params: PageParamsMap[T],
  id: string,
): PageReference<T> {
  return {
    id,
    lastVisited: Date.now(),
    params,
    type,
  };
}
