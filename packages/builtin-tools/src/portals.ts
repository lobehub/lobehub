import {
  LobeDeliveryCheckerManifest,
  LobeDeliveryCheckerPortal,
  LobeDeliveryCheckerPortalActions,
  LobeDeliveryCheckerPortalTitle,
} from '@lobechat/builtin-tool-lobe-delivery-checker/client';
import {
  WebBrowsingManifest,
  WebBrowsingPortal,
  WebBrowsingPortalTitle,
} from '@lobechat/builtin-tool-web-browsing/client';
import { type BuiltinPortal, type BuiltinPortalTitle } from '@lobechat/types';

export const BuiltinToolsPortals: Record<string, BuiltinPortal> = {
  [LobeDeliveryCheckerManifest.identifier]: LobeDeliveryCheckerPortal as BuiltinPortal,
  [WebBrowsingManifest.identifier]: WebBrowsingPortal as BuiltinPortal,
};

/** Optional custom header content per tool, rendered in the portal title slot. */
export const BuiltinToolsPortalTitles: Record<string, BuiltinPortalTitle> = {
  [LobeDeliveryCheckerManifest.identifier]: LobeDeliveryCheckerPortalTitle,
  [WebBrowsingManifest.identifier]: WebBrowsingPortalTitle,
};

/** Optional header right-actions per tool, rendered next to the portal close. */
export const BuiltinToolsPortalActions: Record<string, BuiltinPortalTitle> = {
  [LobeDeliveryCheckerManifest.identifier]: LobeDeliveryCheckerPortalActions,
};
