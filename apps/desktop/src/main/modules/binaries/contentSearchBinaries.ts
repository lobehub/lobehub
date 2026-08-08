import type { BinarySpec } from '@/core/infrastructure/BinaryManager';
import { defineCommandBinary } from '@/core/infrastructure/BinaryManager';

/**
 * Content search binaries
 *
 * Priority order: rg (1) > ag (2) > grep (3)
 * AST search: sg (ast-grep) - separate category for AST-based code search
 */

/**
 * ripgrep (rg) - Fastest grep alternative
 * https://github.com/BurntSushi/ripgrep
 */
export const ripgrepBinary: BinarySpec = defineCommandBinary('rg', {
  description: 'ripgrep - fast grep alternative',
  priority: 1,
});

/**
 * ast-grep (sg) - AST-based code search tool
 * https://ast-grep.github.io/
 */
export const astGrepBinary: BinarySpec = defineCommandBinary('sg', {
  description: 'ast-grep - AST-based code search',
  priority: 1,
});

/**
 * The Silver Searcher (ag) - Fast code searching tool
 * https://github.com/ggreer/the_silver_searcher
 */
export const agBinary: BinarySpec = defineCommandBinary('ag', {
  description: 'The Silver Searcher',
  priority: 2,
});

/**
 * GNU grep - Standard text search tool
 */
export const grepBinary: BinarySpec = defineCommandBinary('grep', {
  description: 'GNU grep',
  priority: 3,
});

/**
 * All content search binaries (text-based grep tools)
 */
export const contentSearchBinaries: BinarySpec[] = [ripgrepBinary, agBinary, grepBinary];

/**
 * AST-based code search binaries
 */
export const astSearchBinaries: BinarySpec[] = [astGrepBinary];
