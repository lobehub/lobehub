/**
 * Re-export the shared file-search types. Kept here so legacy desktop callers
 * that imported them from the `fileSearch/types` path keep compiling after the
 * sink-in to `@lobechat/local-file-shell`.
 */
export type { FileResult, SearchFilesParams as SearchOptions } from '../types';
