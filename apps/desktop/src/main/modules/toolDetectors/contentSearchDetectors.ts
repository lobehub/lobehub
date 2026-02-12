import { IToolDetector, createCommandDetector } from '@/core/infrastructure/ToolDetectorManager';

/**
 * Content search tool detectors
 *
 * Priority order: rg (1) > ag (2) > grep (3)
 * AST search: sg (ast-grep) - separate category for AST-based code search
 */

/**
 * ripgrep (rg) - Fastest grep alternative
 * https://github.com/BurntSushi/ripgrep
 */
export const ripgrepDetector: IToolDetector = createCommandDetector('rg', {
  description: 'ripgrep - fast grep alternative',
  priority: 1,
});

/**
 * ast-grep (sg) - AST-based code search tool
 * https://ast-grep.github.io/
 */
export const astGrepDetector: IToolDetector = createCommandDetector('sg', {
  description: 'ast-grep - AST-based code search',
  priority: 1,
});

/**
 * The Silver Searcher (ag) - Fast code searching tool
 * https://github.com/ggreer/the_silver_searcher
 */
export const agDetector: IToolDetector = createCommandDetector('ag', {
  description: 'The Silver Searcher',
  priority: 2,
});

/**
 * GNU grep - Standard text search tool
 */
export const grepDetector: IToolDetector = createCommandDetector('grep', {
  description: 'GNU grep',
  priority: 3,
});

/**
 * All content search detectors (text-based grep tools)
 */
export const contentSearchDetectors: IToolDetector[] = [ripgrepDetector, agDetector, grepDetector];

/**
 * AST-based code search detectors
 */
export const astSearchDetectors: IToolDetector[] = [astGrepDetector];
