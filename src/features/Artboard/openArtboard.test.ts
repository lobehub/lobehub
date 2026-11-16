import { describe, expect, it } from 'vitest';

import { artboardOpensInPanel } from './openArtboard';

it('reaches the gallery through the specifier the Share build stubs', async () => {
  const source = await import('./openArtboard?raw');
  expect(source.default).toContain("from '@/features/Artboard/Gallery/loader'");
});

describe('artboardOpensInPanel', () => {
  it('uses the side panel inside the conversation the artboard belongs to', () => {
    expect(artboardOpensInPanel('/project/prj_1/topic/tpc_1', 'tpc_1')).toBe(true);
    expect(artboardOpensInPanel('/acme/project/prj_1/topic/tpc_1', 'tpc_1')).toBe(true);
  });

  it('uses the modal anywhere else', () => {
    expect(artboardOpensInPanel('/project/prj_1/topic/tpc_2', 'tpc_1')).toBe(false);
    expect(artboardOpensInPanel('/project/prj_1/topic/tpc_10', 'tpc_1')).toBe(false);
    expect(artboardOpensInPanel('/project/prj_1', 'tpc_1')).toBe(false);
    expect(artboardOpensInPanel('/project/prj_1/topic/tpc_1', null)).toBe(false);
  });
});
