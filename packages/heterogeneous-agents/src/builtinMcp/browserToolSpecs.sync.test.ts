import { BrowserManifest } from '@lobechat/builtin-tool-browser';
import { describe, expect, it } from 'vitest';

import { BROWSER_MCP_TOOLS } from '../../../../apps/desktop/src/main/modules/heterogeneousAgent/browserMcpTools';

/**
 * Cross-instance zod introspection: the mirror's shapes are built by the
 * desktop workspace's own zod copy, so this test cannot wrap them with its
 * zod (`z.toJSONSchema` throws on foreign schemas). `_zod.def` is zod v4's
 * stable structural surface and works across instances.
 */
interface AnyZodNode {
  _def?: { innerType?: unknown; typeName?: string };
  _zod?: { def?: { innerType?: unknown; type?: string } };
}

const V3_TYPE_MAP: Record<string, string> = {
  ZodBoolean: 'boolean',
  ZodNumber: 'number',
  ZodString: 'string',
};

const nodeType = (node: AnyZodNode | undefined): string | undefined =>
  node?._zod?.def?.type ??
  (node?._def?.typeName && V3_TYPE_MAP[node._def.typeName]) ??
  (node?._def?.typeName === 'ZodOptional' || node?._def?.typeName === 'ZodDefault'
    ? node._def.typeName === 'ZodOptional'
      ? 'optional'
      : 'default'
    : undefined);

const innerNode = (node: AnyZodNode): AnyZodNode | undefined =>
  (node._zod?.def?.innerType ?? node._def?.innerType) as AnyZodNode | undefined;

const fieldInfo = (schema: unknown): { optional: boolean; type: string } => {
  let node = schema as AnyZodNode | undefined;
  let optional = false;
  while (node && (nodeType(node) === 'optional' || nodeType(node) === 'default')) {
    optional = true;
    node = innerNode(node);
  }
  return { optional, type: (node && nodeType(node)) ?? 'unknown' };
};

/**
 * Drift guard: the desktop main deliberately does NOT depend on the
 * renderer-side `@lobechat/builtin-tool-browser` package (nested-workspace
 * stub-leak convention — see the mirror note in `browserMcpTools.ts`), so the
 * browser MCP tool specs are hand-mirrored zod shapes. This test — running in
 * the root workspace where BOTH sides are importable — pins the mirror to
 * `BrowserManifest.api`: every api is exposed, and each tool's parameter
 * names, types, and required set match. Descriptions may intentionally differ
 * (e.g. screenshot returns the image to CC but not to the homogeneous
 * runtime), so they are not compared.
 */
describe('browser MCP tool specs stay in sync with BrowserManifest.api', () => {
  const manifestByName = new Map(BrowserManifest.api.map((api) => [api.name, api]));

  it('exposes every manifest api exactly once', () => {
    expect(BROWSER_MCP_TOOLS.map((t) => t.apiName).sort()).toEqual(
      [...manifestByName.keys()].sort(),
    );
  });

  it.each(BROWSER_MCP_TOOLS.map((tool) => [tool.apiName, tool] as const))(
    '%s: parameter names, types and required set match',
    (apiName, tool) => {
      const manifest = manifestByName.get(apiName)!;
      const manifestProps = (manifest.parameters?.properties ?? {}) as Record<
        string,
        { type?: string }
      >;
      const manifestRequired = new Set(
        (manifest.parameters?.required as string[] | undefined) ?? [],
      );

      expect(Object.keys(tool.inputSchema).sort()).toEqual(Object.keys(manifestProps).sort());
      for (const key of Object.keys(manifestProps)) {
        const info = fieldInfo(tool.inputSchema[key]);
        expect(info.type, `type of "${key}" on ${apiName}`).toBe(manifestProps[key]?.type);
        expect(!info.optional, `required-ness of "${key}" on ${apiName}`).toBe(
          manifestRequired.has(key),
        );
      }
    },
  );
});
