import { pathScopeResolver } from '@lobechat/builtin-tool-local-system';
import type { DynamicInterventionResolver } from '@lobechat/types';

export const dynamicInterventionResolvers: Record<string, DynamicInterventionResolver> = {
  pathScopeResolver,
};
