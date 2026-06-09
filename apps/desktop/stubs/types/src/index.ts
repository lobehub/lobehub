/**
 * Desktop isolated workspace stub.
 *
 * `@lobechat/types` is only consumed via `import type` in desktop code and in
 * the `@lobechat/const` entrypoints it reaches (currently `desktopGlobalShortcuts`).
 * Those specifiers are erased at build time, so this package has no runtime
 * exports — we only need to surface the types that reach the desktop tsgo
 * project. Keep these in sync with `packages/types/src/hotkey.ts`.
 */

export type DesktopHotkeyId = 'openSettings' | 'quickChat' | 'quickComposer' | 'showApp';

export interface DesktopHotkeyItem {
  id: DesktopHotkeyId;
  keys: string;
  nonEditable?: boolean;
}

export type DesktopHotkeyConfig = Record<DesktopHotkeyId, string>;

/**
 * Mirror of `@lobechat/types`' `BuiltinServerRuntimeOutput`. Reached by
 * `@lobechat/tool-runtime` (the runtime the gateway controller reuses) via
 * `import type`, so only the shape is needed. Keep in sync with
 * `packages/types/src/tool/builtin.ts`.
 */
export interface BuiltinServerRuntimeOutput {
  content: string;
  error?: unknown;
  state?: unknown;
  success: boolean;
}
