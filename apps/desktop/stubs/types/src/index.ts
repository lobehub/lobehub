/**
 * Desktop isolated workspace stub.
 *
 * Most `@lobechat/types` consumers in the isolated desktop workspace only use
 * type imports. Runtime exports required by workspace packages must be
 * explicitly mirrored inside this package so a clean isolated install remains
 * self-contained.
 */

export { ReasoningGraphSchema } from './graph';

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
