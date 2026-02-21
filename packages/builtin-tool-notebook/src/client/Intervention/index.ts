import type { BuiltinIntervention } from '@lobechat/types';

/**
 * Notebook Tool Intervention Components Registry
 *
 * Intervention components allow users to review and modify tool parameters
 * before the tool is executed.
 */
export const NotebookInterventions: Record<string, BuiltinIntervention> = {};
