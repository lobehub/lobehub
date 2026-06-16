import type { BuiltinPortal, BuiltinPortalTitle } from '@lobechat/types';

const builtinToolsPortals: Record<string, BuiltinPortal> = {};

/** Optional custom header content per tool, rendered in the portal title slot. */
const builtinToolsPortalTitles: Record<string, BuiltinPortalTitle> = {};

/** Optional header right-actions per tool, rendered next to the portal close. */
const builtinToolsPortalActions: Record<string, BuiltinPortalTitle> = {};

interface BuiltinPortalRegistration {
  actions?: Record<string, BuiltinPortalTitle>;
  portals?: Record<string, BuiltinPortal>;
  titles?: Record<string, BuiltinPortalTitle>;
}

export const registerBuiltinPortals = ({
  actions,
  portals,
  titles,
}: BuiltinPortalRegistration): void => {
  if (portals) Object.assign(builtinToolsPortals, portals);
  if (titles) Object.assign(builtinToolsPortalTitles, titles);
  if (actions) Object.assign(builtinToolsPortalActions, actions);
};

export const getBuiltinPortal = (identifier?: string): BuiltinPortal | undefined => {
  if (!identifier) return undefined;
  return builtinToolsPortals[identifier];
};

export const getBuiltinPortalTitle = (identifier?: string): BuiltinPortalTitle | undefined => {
  if (!identifier) return undefined;
  return builtinToolsPortalTitles[identifier];
};

export const getBuiltinPortalAction = (identifier?: string): BuiltinPortalTitle | undefined => {
  if (!identifier) return undefined;
  return builtinToolsPortalActions[identifier];
};
