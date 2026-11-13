import { describe, expect, it } from 'vitest';

import { artboardOpensInPanel } from './openArtboard';

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
