import { isDesktop, OFFICIAL_URL } from '@lobechat/const';
import { SKIP, visit } from 'unist-util-visit';

import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

import { LOBE_FILE_LINK_TAG, parseFileLinkHref } from './parse';

const getNodeText = (node: any): string => {
  if (!node) return '';
  if (node.type === 'text') return String(node.value ?? '');
  if (Array.isArray(node.children)) return node.children.map(getNodeText).join('');
  return '';
};

/**
 * The origins file links should be classified against. On desktop the
 * renderer's own origin isn't the app's — exported files are absolute URLs
 * pointing at the remote server, so that's what has to match (see useAppOrigin,
 * this plugin's non-hook equivalent).
 *
 * In cloud mode the remote server is the gateway apex (`OFFICIAL_CLOUD_URL`),
 * but the cloud server still writes file proxy links with its own `APP_URL`
 * (`OFFICIAL_URL`), so both origins count as the official cloud.
 */
const getCurrentOrigins = (): string[] => {
  if (typeof window === 'undefined') return [];
  if (!isDesktop) return [window.location.origin];

  const state = useElectronStore.getState();
  const remoteServerUrl = electronSyncSelectors.remoteServerUrl(state);
  if (electronSyncSelectors.storageMode(state) === 'cloud') {
    return [remoteServerUrl, OFFICIAL_URL].filter(Boolean);
  }

  return remoteServerUrl ? [remoteServerUrl] : [];
};

const parseAgainstOrigins = (href: string | undefined, origins: string[]) => {
  const options = { activeWorkspaceSlug: getActiveWorkspaceSlug() };
  if (origins.length === 0) return parseFileLinkHref(href, undefined, options);

  for (const origin of origins) {
    const parsed = parseFileLinkHref(href, origin, options);
    if (parsed) return parsed;
  }

  return null;
};

/**
 * Rehype plugin that rewrites `<a href="{APP_URL}/f/:fileId">` anchors —
 * produced by assistant tool output such as code execution file export — and
 * Docs file links (`/resource/file/:fileId`, which `lh file upload` prints)
 * into a custom `<lobeFileLink>` element, so they open the in-app file
 * preview panel instead of navigating away. Must run before Link's generic
 * `rehypeLobeLink`, which would otherwise consume the same anchor first.
 */
export const rehypeFileLink = () => (tree: any) => {
  visit(tree, 'element', (node: any) => {
    if (node.tagName !== 'a') return;

    const href = node.properties?.href as string | undefined;
    const parsed = parseAgainstOrigins(href, getCurrentOrigins());
    if (!parsed) return;

    const text = getNodeText(node).trim();
    const label = text || parsed.fileId;

    node.tagName = LOBE_FILE_LINK_TAG;
    node.children = [];
    node.properties = {
      fileId: parsed.fileId,
      linkHref: href,
      linkLabel: label,
      proxyHref: parsed.proxyHref,
    };

    return SKIP;
  });
};
