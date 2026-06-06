import {
  LobeAgentManifest,
  LobeAgentPortal,
  LobeAgentPortalTitle,
} from '@lobechat/builtin-tool-lobe-agent/client';
import {
  WebBrowsingManifest,
  WebBrowsingPortal,
  WebBrowsingPortalTitle,
} from '@lobechat/builtin-tool-web-browsing/client';
import { type BuiltinPortal, type BuiltinPortalTitle } from '@lobechat/types';

export const BuiltinToolsPortals: Record<string, BuiltinPortal> = {
  [LobeAgentManifest.identifier]: LobeAgentPortal as BuiltinPortal,
  [WebBrowsingManifest.identifier]: WebBrowsingPortal as BuiltinPortal,
};

/** Optional custom header content per tool, rendered in the portal title slot. */
export const BuiltinToolsPortalTitles: Record<string, BuiltinPortalTitle> = {
  [LobeAgentManifest.identifier]: LobeAgentPortalTitle,
  [WebBrowsingManifest.identifier]: WebBrowsingPortalTitle,
};
