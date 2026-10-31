import { describe, expect, it } from 'vitest';

import { buildToolSet, toolName } from '../shareGate/testUtils';
import { applyEvalGateToToolSet } from './toolSet';

describe('applyEvalGateToToolSet', () => {
  it('drops every tool the case did not declare, from every structure', () => {
    const toolSet = buildToolSet([
      { apis: [{ name: 'search' }], identifier: 'notion', type: 'mcp' },
      { apis: [{ name: 'gmail_search_emails' }], identifier: 'gmail', type: 'mcp' },
      { apis: [{ name: 'runCommand' }], identifier: 'lobe-local-system' },
      { apis: [{ name: 'activateTools' }], identifier: 'lobe-activator' },
    ]);

    applyEvalGateToToolSet(toolSet, ['notion', 'lobe-activator']);

    expect(Object.keys(toolSet.manifestMap).sort()).toEqual(['lobe-activator', 'notion']);
    expect(Object.keys(toolSet.executorMap).sort()).toEqual(['lobe-activator', 'notion']);
    expect(Object.keys(toolSet.sourceMap).sort()).toEqual(['lobe-activator', 'notion']);
    expect(toolSet.enabledToolIds.sort()).toEqual(['lobe-activator', 'notion']);
    expect(toolSet.activatableToolIds.sort()).toEqual(['lobe-activator', 'notion']);
    const names = (toolSet.tools ?? []).map((tool: any) => tool.function?.name ?? tool.name);
    expect(names).toContain(toolName('notion', 'search', 'mcp'));
    expect(names).not.toContain(toolName('gmail', 'gmail_search_emails', 'mcp'));
    expect(names).not.toContain(toolName('lobe-local-system', 'runCommand'));
  });

  it('leaves a tool set alone when everything in it is allowed', () => {
    const toolSet = buildToolSet([
      { apis: [{ name: 'search' }], identifier: 'notion', type: 'mcp' },
    ]);
    const before = JSON.stringify(toolSet);

    applyEvalGateToToolSet(toolSet, ['notion', 'lobe-activator']);

    expect(JSON.stringify(toolSet)).toBe(before);
  });

  it('empties the set when the case declares no tools at all', () => {
    const toolSet = buildToolSet([
      { apis: [{ name: 'search' }], identifier: 'notion', type: 'mcp' },
    ]);

    applyEvalGateToToolSet(toolSet, []);

    expect(toolSet.manifestMap).toEqual({});
    expect(toolSet.tools).toEqual([]);
  });
});
