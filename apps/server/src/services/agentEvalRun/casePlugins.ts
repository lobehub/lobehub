import { isBuiltinToolIdentifier } from '@lobechat/builtin-tools';
import type { EvalCaseEnvironment, EvalMockConfig, ToolManifest } from '@lobechat/types';

import { PluginModel } from '@/database/models/plugin';
import { mcpService } from '@/server/services/mcp';

import { MOCK_SERVICE_NOT_CONFIGURED } from './mockService';
import type { EvalRunDeps } from './types';
import { getEvalMockConfig, getMockDiscoveryOrigin, getMockDiscoveryUrl, log } from './utils';

/**
 * Mock connectors as installed plugins.
 *
 * A case Agent only lists plugin identifiers. The tools the model actually
 * sees come from the account's installed plugins, whose manifests LobeHub
 * reads from each MCP server when the plugin is installed. A benchmark's mock
 * connectors live on its mock service, not in the plugin store, so an account
 * that creates a run must have them installed from there first, or every case
 * Agent of the run answers with an empty tool list and no hint why.
 *
 * `ensureCasePlugins` installs what a batch of cases lists, once per
 * identifier, marks the rows it owns (`customParams.lobeBench`), refreshes a
 * row when the cases now point at another discovery URL, and never overwrites
 * a plugin the account installed for itself.
 */

interface CasePluginTestCase {
  content: { environment?: EvalCaseEnvironment };
}

export interface CasePluginsResult {
  /** Installed by hand from the same mock before (the import script); claimed without re-reading. */
  adopted: string[];
  /** Read from the mock and written now (new, or refreshed from another URL). */
  installed: string[];
  /** Already installed by an earlier run from the same URL. */
  kept: string[];
}

/**
 * The mock connectors the cases' Agents list: declared in `mock.services` and
 * in the case Agent's plugin list. Builtin tools need no install even when
 * their calls are forwarded to the mock.
 */
export const collectMockPluginIds = (testCases: CasePluginTestCase[]): string[] => {
  const ids = new Set<string>();
  for (const { content } of testCases) {
    const services = content.environment?.mock?.services;
    const plugins = content.environment?.agent?.plugins;
    if (!services?.length || !plugins) continue;
    for (const id of plugins) {
      if (services.includes(id) && !isBuiltinToolIdentifier(id)) ids.add(id);
    }
  }
  return [...ids].sort();
};

const readMockManifest = async (
  mock: EvalMockConfig,
  identifier: string,
  url: string,
): Promise<ToolManifest> => {
  const meta = mock.connectors?.[identifier];
  let manifest: ToolManifest;
  try {
    manifest = await mcpService.getStreamableMcpServerManifest(identifier, url, {
      avatar: meta?.avatar ?? 'MCP_AVATAR',
      description: meta?.description,
    });
  } catch (error) {
    throw new Error(
      `Could not read mock connector "${identifier}" from ${url}: ${(error as Error).message}`,
      { cause: error },
    );
  }
  if (!manifest.api?.length) {
    throw new Error(`Mock connector "${identifier}" at ${url} lists no tools`);
  }
  // The title reaches the prompt as the tool's name; without one the model
  // would see the bare identifier where a real connector shows its name.
  return meta?.title ? { ...manifest, meta: { ...manifest.meta, title: meta.title } } : manifest;
};

export async function ensureCasePlugins(
  deps: EvalRunDeps,
  datasetId: string | null | undefined,
  testCases: CasePluginTestCase[],
): Promise<CasePluginsResult> {
  const result: CasePluginsResult = { adopted: [], installed: [], kept: [] };
  const ids = collectMockPluginIds(testCases);
  if (ids.length === 0 || !datasetId) return result;

  const dataset = await deps.datasetModel.findById(datasetId);
  if (!dataset) return result;
  const benchmark = dataset.benchmarkId
    ? await deps.benchmarkModel.findById(dataset.benchmarkId)
    : null;
  const mock = getEvalMockConfig(
    benchmark as { metadata?: Record<string, unknown> | null } | null,
    dataset as { metadata?: Record<string, unknown> | null },
  );
  if (!mock) {
    throw new Error(
      `The cases list mock connectors (${ids.join(', ')}) but ${MOCK_SERVICE_NOT_CONFIGURED}`,
    );
  }

  const datasetIdentifier = dataset.identifier ?? dataset.id;
  const pluginModel = new PluginModel(deps.db, deps.userId, deps.workspaceId);
  const installed = new Map((await pluginModel.query()).map((item) => [item.identifier, item]));
  const mockOrigin = getMockDiscoveryOrigin(mock);

  for (const id of ids) {
    const url = getMockDiscoveryUrl(mock, datasetIdentifier, id);
    const existing = installed.get(id);

    if (existing) {
      if (existing.customParams?.lobeBench?.url === url) {
        result.kept.push(id);
        continue;
      }
      const existingUrl = existing.customParams?.mcp?.url;
      // Ours when Lobe Bench installed it (marker) or it already points at this mock; anything
      // else is a connector the user set up themselves and must not be overwritten.
      const ours = !!existing.customParams?.lobeBench?.url || !!existingUrl?.startsWith(mockOrigin);
      if (!ours) {
        throw new Error(
          `Plugin "${id}" is already installed in this account and is not a mock connector of this benchmark; remove or rename it before running these cases`,
        );
      }
      if (existingUrl === url && existing.manifest?.api?.length) {
        await pluginModel.update(id, {
          customParams: { ...existing.customParams, lobeBench: { url } },
        });
        result.adopted.push(id);
        continue;
      }
      // Same mock under another dataset, a mock that moved to a new origin (local → public,
      // staging → production), or an empty manifest: read it again below and re-point the plugin.
    }

    const manifest = await readMockManifest(mock, id, url);
    await pluginModel.create({
      customParams: { lobeBench: { url }, mcp: { type: 'http', url } },
      identifier: id,
      manifest,
      type: 'customPlugin',
    });
    result.installed.push(id);
  }

  log('mock connectors for dataset %s: %O', datasetId, result);
  return result;
}
