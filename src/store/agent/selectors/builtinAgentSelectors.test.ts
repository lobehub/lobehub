import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { INBOX_SESSION_ID } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { type AgentStoreState } from '@/store/agent/initialState';
import { initialAgentSliceState } from '@/store/agent/slices/agent/initialState';
import { initialAgentArtworkSliceState } from '@/store/agent/slices/artwork/initialState';
import { initialBuiltinAgentSliceState } from '@/store/agent/slices/builtin';

import { builtinAgentSelectors } from './builtinAgentSelectors';

const createState = (overrides: Partial<AgentStoreState> = {}): AgentStoreState => ({
  ...initialAgentArtworkSliceState,
  ...initialAgentSliceState,
  ...initialBuiltinAgentSliceState,
  ...overrides,
});

describe('builtinAgentSelectors', () => {
  describe('getBuiltinAgentId', () => {
    it('should return agent id for a given slug', () => {
      const state = createState({
        builtinAgentIdMap: { 'page-agent': 'page-agent-123' },
      });

      expect(builtinAgentSelectors.getBuiltinAgentId('page-agent')(state)).toBe('page-agent-123');
    });

    it('should return undefined for non-existent slug', () => {
      const state = createState({
        builtinAgentIdMap: {},
      });

      expect(builtinAgentSelectors.getBuiltinAgentId('page-agent')(state)).toBeUndefined();
    });
  });

  describe('isBuiltinAgentInit', () => {
    it('should return true when builtin agent exists', () => {
      const state = createState({
        builtinAgentIdMap: { 'page-agent': 'page-agent-123' },
      });

      expect(builtinAgentSelectors.isBuiltinAgentInit('page-agent')(state)).toBe(true);
    });

    it('should return false when builtin agent does not exist', () => {
      const state = createState({
        builtinAgentIdMap: {},
      });

      expect(builtinAgentSelectors.isBuiltinAgentInit('page-agent')(state)).toBe(false);
    });
  });

  describe('pageAgentId', () => {
    it('should return page agent id', () => {
      const state = createState({
        builtinAgentIdMap: { [BUILTIN_AGENT_SLUGS.pageAgent]: 'page-agent-456' },
      });

      expect(builtinAgentSelectors.pageAgentId(state)).toBe('page-agent-456');
    });

    it('should return undefined when page agent not initialized', () => {
      const state = createState({
        builtinAgentIdMap: {},
      });

      expect(builtinAgentSelectors.pageAgentId(state)).toBeUndefined();
    });
  });

  describe('taskAgentId', () => {
    it('should return task agent id', () => {
      const state = createState({
        builtinAgentIdMap: { [BUILTIN_AGENT_SLUGS.taskAgent]: 'task-agent-456' },
      });

      expect(builtinAgentSelectors.taskAgentId(state)).toBe('task-agent-456');
    });

    it('should return undefined when task agent not initialized', () => {
      const state = createState({
        builtinAgentIdMap: {},
      });

      expect(builtinAgentSelectors.taskAgentId(state)).toBeUndefined();
    });
  });

  describe('agentBuilderId', () => {
    it('should return agent builder id', () => {
      const state = createState({
        builtinAgentIdMap: { [BUILTIN_AGENT_SLUGS.agentBuilder]: 'builder-789' },
      });

      expect(builtinAgentSelectors.agentBuilderId(state)).toBe('builder-789');
    });

    it('should return undefined when agent builder not initialized', () => {
      const state = createState({
        builtinAgentIdMap: {},
      });

      expect(builtinAgentSelectors.agentBuilderId(state)).toBeUndefined();
    });
  });

  describe('inboxAgentId', () => {
    it('should return inbox agent id from builtinAgentIdMap', () => {
      const state = createState({
        builtinAgentIdMap: { [INBOX_SESSION_ID]: 'inbox-agent-123' },
      });

      expect(builtinAgentSelectors.inboxAgentId(state)).toBe('inbox-agent-123');
    });

    it('should return undefined when inbox agent is not initialized', () => {
      const state = createState({
        builtinAgentIdMap: {},
      });

      expect(builtinAgentSelectors.inboxAgentId(state)).toBeUndefined();
    });
  });

  describe('isInboxAgentConfigInit', () => {
    it('should return true when inbox agent is in builtinAgentIdMap', () => {
      const state = createState({
        builtinAgentIdMap: { [INBOX_SESSION_ID]: 'inbox-agent-id' },
      });

      expect(builtinAgentSelectors.isInboxAgentConfigInit(state)).toBe(true);
    });

    it('should return false when inbox agent is not initialized', () => {
      const state = createState({
        builtinAgentIdMap: {},
      });

      expect(builtinAgentSelectors.isInboxAgentConfigInit(state)).toBe(false);
    });
  });

  describe('isInboxAgent', () => {
    it('should return true when activeAgentId matches inbox agent in builtinAgentIdMap', () => {
      const state = createState({
        activeAgentId: 'inbox-agent',
        builtinAgentIdMap: { [INBOX_SESSION_ID]: 'inbox-agent' },
      });

      expect(builtinAgentSelectors.isInboxAgent(state)).toBe(true);
    });

    it('should return false when activeAgentId does not match inbox agent', () => {
      const state = createState({
        activeAgentId: 'other-agent',
        builtinAgentIdMap: { [INBOX_SESSION_ID]: 'inbox-agent' },
      });

      expect(builtinAgentSelectors.isInboxAgent(state)).toBe(false);
    });

    it('should return false when inbox agent is not initialized', () => {
      const state = createState({
        activeAgentId: 'some-agent',
        builtinAgentIdMap: {},
      });

      expect(builtinAgentSelectors.isInboxAgent(state)).toBe(false);
    });
  });

  // workspace members may now *configure* the collaborative builtin
  // rows, so ownership affordances (delete / transfer) have to be suppressed for
  // them explicitly — the server still rejects those actions.
  describe('isBuiltinAgent', () => {
    const state = createState({
      agentMap: {
        'agt_user_created': { slug: 'my-own-slug', virtual: false },
        // legacy collision: reserved slug, but never provisioned
        'legacy-collision': { slug: 'agent-builder', virtual: false },
        'page-agent-row': { slug: 'page-agent', virtual: true },
        // hydrated from the list payload, which carries neither marker
        'partially-hydrated': { title: 'From the list' },
      },
      builtinAgentIdMap: { [INBOX_SESSION_ID]: 'inbox-agent', 'agent-builder': 'builder-agent' },
    });

    it('should classify a hydrated row by slug + virtual', () => {
      // `page-agent` is absent from `builtinAgentIdMap` — this is the case that
      // used to leak a Delete action onto a builtin profile opened directly.
      expect(builtinAgentSelectors.isBuiltinAgent('page-agent-row')(state)).toBe(true);
      expect(builtinAgentSelectors.isBuiltinAgent('agt_user_created')(state)).toBe(false);
    });

    // Matches the server: a reserved slug alone does not make a row infrastructure,
    // so its owner keeps the ownership actions.
    it('should treat a non-provisioned reserved-slug row as ordinary', () => {
      expect(builtinAgentSelectors.isBuiltinAgent('legacy-collision')(state)).toBe(false);
    });

    it('should fall back to the init map when the row lacks the markers', () => {
      expect(builtinAgentSelectors.isBuiltinAgent('partially-hydrated')(state)).toBe(false);
    });

    it('should fall back to the init map when the row is not hydrated', () => {
      expect(builtinAgentSelectors.isBuiltinAgent('inbox-agent')(state)).toBe(true);
      expect(builtinAgentSelectors.isBuiltinAgent('builder-agent')(state)).toBe(true);
    });

    it('should return false for an unknown agent', () => {
      expect(builtinAgentSelectors.isBuiltinAgent('agt_never_seen')(state)).toBe(false);
    });

    it('should return false without an agent id', () => {
      expect(builtinAgentSelectors.isBuiltinAgent(undefined)(state)).toBe(false);
    });
  });
});
