import { describe, expect, it } from 'vitest';

import { getAgentRuntimeConfig } from '../index';
import { BUILTIN_AGENT_SLUGS } from '../types';

/**
 * @example
 * Verifies that every Inbox pipeline role is registered with a proposal-first prompt.
 */
describe('Inbox pipeline built-in agents', () => {
  /**
   * @example
   * Resolves all role slugs and checks their stable output contracts.
   */
  it('registers specialized proposal-only roles', () => {
    const intake = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.inboxIntake, {});
    const curator = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.knowledgeCurator, {});
    const issuePrd = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.issuePrd, {});

    // @example The intake agent exposes the document and confirmation capabilities it may use in apply mode.
    expect(intake?.plugins).toEqual(['lobe-agent-documents', 'lobe-user-interaction']);
    // @example The curator can persist a reviewed document candidate in apply mode.
    expect(curator?.plugins).toEqual(['lobe-agent-documents']);
    // @example The issue role can persist reviewed work through Task or Linear in apply mode.
    expect(issuePrd?.plugins).toEqual(['lobe-task', 'linear']);

    // @example Every role defaults to a side-effect-free proposal.
    expect(intake?.systemRole).toContain('Default to proposal-only mode');
    // @example Curator output is constrained to stable structured JSON.
    expect(curator?.systemRole).toContain('Return valid JSON only');
    // @example Transient tasks stay outside the knowledge curation boundary.
    expect(curator?.systemRole).toContain('Exclude transient execution tasks');
    // @example Issue drafts require explicit authorization before persistence.
    expect(issuePrd?.systemRole).toContain('exact authorized proposals');
    // @example Relative dates remain evidence instead of being guessed from runtime context.
    expect(issuePrd?.systemRole).toContain('Preserve relative dates');
  });
});
