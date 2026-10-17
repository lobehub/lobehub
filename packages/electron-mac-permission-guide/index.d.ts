export type PermissionGuideAccessory = 'appIcon' | 'settingsIcon' | 'spinner' | 'success';

export interface PermissionGuideState {
  accessory: PermissionGuideAccessory;
  actionLabel?: string;
  actionStyle?: 'primary' | 'secondary';
  appPath: string;
  bottomInset?: number;
  closeLabel: string;
  draggable: boolean;
  iconLabel?: string;
  /** Screen point (top-left origin) the panel flies in from on first appearance. */
  launchOrigin?: { x: number; y: number };
  missingTimeoutMs?: number;
  /** Width of the Settings sidebar; 0 centers the panel on the whole window. */
  sidebarWidth?: number;
  subtitle?: string;
  title: string;
}

export type PermissionGuideEvent =
  | { type: 'action' }
  | { type: 'close' }
  | { type: 'dragStarted' }
  | { dropped: boolean; type: 'dragEnded' }
  | { type: 'navigationClicked' }
  | { type: 'promptDismissed' }
  | { type: 'promptShown' }
  | { type: 'settingsFound' }
  | { type: 'settingsLost' }
  | { title: string; type: 'windowTitle' };

export function isSupported(): boolean;
export function showGuide(state: PermissionGuideState): boolean;
export function hideGuide(): void;
export function activateSettings(): void;
export function onGuideEvent(listener: (event: PermissionGuideEvent) => void): () => void;
