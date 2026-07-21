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

export type HeterogeneousAgentModelCatalogErrorCode =
  'cli_not_found' | 'command_failed' | 'device_unavailable' | 'timeout' | 'unsupported_client';

export interface HeterogeneousAgentModel {
  id: string;
  modelId: string;
  providerId: string;
}

export interface ListHeterogeneousAgentModelsParams {
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  type: 'opencode';
}

export interface HeterogeneousAgentModelCatalogSuccess {
  models: HeterogeneousAgentModel[];
  status: 'success';
  updatedAt: number;
}

export interface HeterogeneousAgentModelCatalogFailure {
  error: {
    code: HeterogeneousAgentModelCatalogErrorCode;
    message: string;
  };
  status: 'error';
  updatedAt: number;
}

export type HeterogeneousAgentModelCatalog =
  HeterogeneousAgentModelCatalogFailure | HeterogeneousAgentModelCatalogSuccess;

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
