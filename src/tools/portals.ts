import { WebBrowsingManifest, WebBrowsingPortal } from '@lobechat/builtin-tool-web-browsing/client';
import type {BuiltinPortal} from '@lobechat/types';

export const BuiltinToolsPortals: Record<string, BuiltinPortal> = {
  [WebBrowsingManifest.identifier]: WebBrowsingPortal as BuiltinPortal,
};
