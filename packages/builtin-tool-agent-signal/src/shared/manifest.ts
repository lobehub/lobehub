import type { BuiltinToolManifest } from '@lobechat/types';

interface ToolApiSpec {
  description: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface CreateAgentSignalManifestOptions {
  apis: ToolApiSpec[];
  description: string;
  identifier: string;
  systemRole: string;
  title: string;
}

/**
 * Builds one builtin tool manifest for a self-iteration mode. `executors` is
 * omitted on purpose — `BuiltinToolManifest` defaults to server-only execution,
 * which is exactly what these background-agent tools need.
 */
export const createAgentSignalManifest = (
  options: CreateAgentSignalManifestOptions,
): BuiltinToolManifest =>
  ({
    api: options.apis,
    identifier: options.identifier,
    meta: { description: options.description, title: options.title },
    systemRole: options.systemRole,
    type: 'builtin',
  }) as BuiltinToolManifest;
