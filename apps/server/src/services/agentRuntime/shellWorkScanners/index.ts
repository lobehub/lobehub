import { githubShellWorkScanner } from './github';
import type { ShellWorkScanner } from './types';

export type { ShellWorkScanner } from './types';

/**
 * Every CLI family the completion-time shell Work scan recognizes. To support
 * a new CLI: add a normalizer next to the existing ones in
 * `@/database/models/work`, define its scanner in a sibling file here, and
 * append it to this list.
 */
export const SHELL_WORK_SCANNERS: ShellWorkScanner[] = [githubShellWorkScanner];
