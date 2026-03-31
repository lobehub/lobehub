import { WEB_ONBOARDING } from '@lobechat/builtin-agents';
import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import {
  GroupAgentBuilderApiName,
  GroupAgentBuilderIdentifier,
} from '@lobechat/builtin-tool-group-agent-builder';
import { GroupAgentBuilderInspectors } from '@lobechat/builtin-tool-group-agent-builder/client';
import { SkillStoreApiName, SkillStoreIdentifier } from '@lobechat/builtin-tool-skill-store';
import { SkillStoreInspectors, SkillStoreRenders } from '@lobechat/builtin-tool-skill-store/client';
import { WebOnboardingIdentifier } from '@lobechat/builtin-tool-web-onboarding';
import { builtinToolIdentifiers } from '@lobechat/builtin-tools/identifiers';
import { describe, expect, it } from 'vitest';

describe('builtin tool registry', () => {
  it('includes skill store in builtin identifiers', () => {
    expect(builtinToolIdentifiers).toContain(SkillStoreIdentifier);
  });

  it('includes web onboarding in builtin identifiers', () => {
    expect(builtinToolIdentifiers).toContain(WebOnboardingIdentifier);
  });

  it('registers skill store inspectors and renders for market flows', () => {
    expect(SkillStoreInspectors[SkillStoreApiName.importFromMarket]).toBeDefined();
    expect(SkillStoreInspectors[SkillStoreApiName.searchSkill]).toBeDefined();
    expect(SkillStoreRenders[SkillStoreApiName.importFromMarket]).toBeDefined();
    expect(SkillStoreRenders[SkillStoreApiName.searchSkill]).toBeDefined();
  });

  it('registers group agent builder createGroup inspector', () => {
    expect(builtinToolIdentifiers).toContain(GroupAgentBuilderIdentifier);
    expect(GroupAgentBuilderInspectors[GroupAgentBuilderApiName.createGroup]).toBeDefined();
  });

  it('includes agent and group management tools in web onboarding runtime', () => {
    const runtime =
      typeof WEB_ONBOARDING.runtime === 'function'
        ? WEB_ONBOARDING.runtime({ userLocale: 'en-US' })
        : WEB_ONBOARDING.runtime;

    expect(runtime.plugins).toContain(AgentManagementIdentifier);
    expect(runtime.plugins).toContain(GroupAgentBuilderIdentifier);
  });
});
