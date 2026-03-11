import { SkillStoreApiName, SkillStoreIdentifier } from '@lobechat/builtin-tool-skill-store';
import { SkillStoreInspectors, SkillStoreRenders } from '@lobechat/builtin-tool-skill-store/client';
import { builtinToolIdentifiers } from '@lobechat/builtin-tools/identifiers';
import { describe, expect, it } from 'vitest';

describe('builtin tool registry', () => {
  it('includes skill store in builtin identifiers', () => {
    expect(builtinToolIdentifiers).toContain(SkillStoreIdentifier);
  });

  it('registers skill store inspectors and renders for market flows', () => {
    expect(SkillStoreInspectors[SkillStoreApiName.importFromMarket]).toBeDefined();
    expect(SkillStoreInspectors[SkillStoreApiName.searchSkill]).toBeDefined();
    expect(SkillStoreRenders[SkillStoreApiName.importFromMarket]).toBeDefined();
    expect(SkillStoreRenders[SkillStoreApiName.searchSkill]).toBeDefined();
  });
});
