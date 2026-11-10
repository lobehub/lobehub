import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import { describe, expect, it } from 'vitest';

import { buildToolDiscoveryConfig } from './executorHelpers';

const manifest = (identifier: string, extra: Record<string, unknown> = {}) =>
  ({ api: [], identifier, meta: { title: identifier }, ...extra }) as never;

describe('buildToolDiscoveryConfig with Code Mode', () => {
  it('keeps connectors folded into Code Mode out of the activator list', () => {
    const manifestMap = {
      [LobeActivatorIdentifier]: manifest(LobeActivatorIdentifier),
      'github': manifest('github'),
      'lobe-code-mode': manifest('lobe-code-mode', { codeMode: { toolIds: ['github'] } }),
      'notion': manifest('notion'),
    };

    const config = buildToolDiscoveryConfig({ manifestMap } as never, [
      LobeActivatorIdentifier,
      'lobe-code-mode',
    ]);

    expect(config?.availableTools.map((tool) => tool.identifier)).toEqual(['notion']);
  });
});
