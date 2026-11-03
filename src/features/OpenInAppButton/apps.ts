import type { OpenInAppId } from '@lobechat/electron-client-ipc';
import { Cursor } from '@lobehub/icons';
import {
  AppleIcon,
  CodeIcon,
  CodeXmlIcon,
  FolderIcon,
  FolderOpenIcon,
  GhostIcon,
  HammerIcon,
  SquareTerminalIcon,
  TerminalIcon,
} from 'lucide-react';
import type { FC } from 'react';

// Renderer-side mapping from AppId → icon component. The displayName comes from
// the main-process detectApps result (the source of truth), so we only map icons here.
// `FC<any>` is the widest shape accepted by `@lobehub/ui`'s `Icon` component and
// covers both lucide-react icons and `@lobehub/icons` brand icons.
type IconLike = FC<any>;

export const APP_ICONS: Record<OpenInAppId, IconLike> = {
  cursor: Cursor as IconLike,
  explorer: FolderIcon,
  files: FolderOpenIcon,
  finder: FolderIcon,
  ghostty: GhostIcon,
  iterm2: SquareTerminalIcon,
  terminal: TerminalIcon,
  vscode: CodeIcon,
  webstorm: HammerIcon,
  xcode: AppleIcon,
  zed: CodeXmlIcon,
};

// Platform fallback when no user pref or user's pref is uninstalled.
export const PLATFORM_DEFAULT_APP: Record<NodeJS.Platform, OpenInAppId> = {
  aix: 'files',
  android: 'files',
  cygwin: 'files',
  darwin: 'finder',
  freebsd: 'files',
  haiku: 'files',
  linux: 'files',
  netbsd: 'files',
  openbsd: 'files',
  sunos: 'files',
  win32: 'explorer',
};

export const resolveDefaultApp = (
  userDefault: string | null | undefined,
  installedIds: ReadonlySet<string>,
  platform: NodeJS.Platform,
): OpenInAppId => {
  if (userDefault && installedIds.has(userDefault)) return userDefault as OpenInAppId;

  const fallback = PLATFORM_DEFAULT_APP[platform] ?? 'finder';
  if (installedIds.has(fallback)) return fallback;

  // Last resort: first installed app, else the platform fallback (the main-process
  // not-installed guard will surface a localized error toast if invoked).
  const first = [...installedIds][0] as OpenInAppId | undefined;
  return first ?? fallback;
};
