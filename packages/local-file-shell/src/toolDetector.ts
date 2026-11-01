/**
 * Tool categories the search modules consult when picking the best available
 * binary on the host.
 */
export type ToolCategory = 'content-search' | 'file-search';

/**
 * Minimal contract the search modules need from a tool detector. Desktop
 * injects its full BinaryManager (which also handles registration and
 * caching); CLI / sandbox can leave it unset, in which case each impl falls
 * back to its own `which`-based detection.
 */
export interface ToolDetector {
  getBestTool: (category: ToolCategory) => Promise<string | null>;
}
