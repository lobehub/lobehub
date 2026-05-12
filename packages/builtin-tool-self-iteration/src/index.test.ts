import type { LobeToolManifest, OperationToolSet, ToolSource } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import {
  injectSelfFeedbackIntentTool,
  SELF_FEEDBACK_INTENT_API_NAME,
  SELF_FEEDBACK_INTENT_IDENTIFIER,
  SELF_FEEDBACK_INTENT_TOOL_NAME,
  selfFeedbackIntentManifest,
  shouldExposeSelfFeedbackIntentTool,
} from './index';

interface ToolSetParts {
  enabledToolIds: string[];
  manifestMap: Record<string, LobeToolManifest>;
  sourceMap: Record<string, ToolSource>;
  tools: OperationToolSet['tools'];
}

const createToolSetParts = (): ToolSetParts => ({
  enabledToolIds: [],
  manifestMap: {},
  sourceMap: {},
  tools: [],
});

describe('selfFeedbackIntentTool', () => {
  describe('shouldExposeSelfFeedbackIntentTool', () => {
    /**
     * @example
     * Runtime injection is visible only when the feature/user and agent-level gates pass.
     */
    it('is visible only when all gates pass', () => {
      expect(
        shouldExposeSelfFeedbackIntentTool({
          agentSelfIterationEnabled: true,
          featureUserEnabled: true,
        }),
      ).toBe(true);

      expect(
        shouldExposeSelfFeedbackIntentTool({
          agentSelfIterationEnabled: false,
          featureUserEnabled: true,
        }),
      ).toBe(false);
      expect(
        shouldExposeSelfFeedbackIntentTool({
          agentSelfIterationEnabled: true,
          featureUserEnabled: false,
        }),
      ).toBe(false);
    });

    /**
     * @example
     * Explicit disable flags hide the tool from reviewer or no-tool runtime paths.
     */
    it('is hidden when disabled or reviewer role is set', () => {
      expect(
        shouldExposeSelfFeedbackIntentTool({
          agentSelfIterationEnabled: true,
          disabled: true,
          featureUserEnabled: true,
        }),
      ).toBe(false);
      expect(
        shouldExposeSelfFeedbackIntentTool({
          agentSelfIterationEnabled: true,
          disableSelfFeedbackIntentTool: true,
          featureUserEnabled: true,
        }),
      ).toBe(false);
      expect(
        shouldExposeSelfFeedbackIntentTool({
          agentSelfIterationEnabled: true,
          featureUserEnabled: true,
          reviewerRole: true,
        }),
      ).toBe(false);
    });
  });

  describe('selfFeedbackIntentManifest', () => {
    /**
     * @example
     * The declaration schema exposes every field accepted by DeclareSelfFeedbackIntentPayload.
     */
    it('declares the expected input schema fields', () => {
      const api = selfFeedbackIntentManifest.api[0];
      const properties = api.parameters.properties;

      expect(selfFeedbackIntentManifest.identifier).toBe(SELF_FEEDBACK_INTENT_IDENTIFIER);
      expect(api.name).toBe(SELF_FEEDBACK_INTENT_API_NAME);
      expect(Object.keys(properties)).toEqual([
        'action',
        'kind',
        'confidence',
        'summary',
        'reason',
        'evidenceRefs',
        'memoryId',
        'skillId',
      ]);
      expect(api.description).toContain('does not mutate memory or skills');
      expect(api.parameters.required).toEqual([
        'action',
        'kind',
        'confidence',
        'summary',
        'reason',
      ]);
    });
  });

  describe('injectSelfFeedbackIntentTool', () => {
    /**
     * @example
     * The helper injects a builtin manifest, generated LLM tool, and enabled id.
     */
    it('injects the builtin tool parts with the generated tool name', () => {
      const toolSetParts = createToolSetParts();

      const injected = injectSelfFeedbackIntentTool(toolSetParts);

      expect(injected).toBe(true);
      expect(toolSetParts.enabledToolIds).toContain(SELF_FEEDBACK_INTENT_IDENTIFIER);
      expect(toolSetParts.sourceMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBe('builtin');
      expect(toolSetParts.manifestMap[SELF_FEEDBACK_INTENT_IDENTIFIER]).toBe(
        selfFeedbackIntentManifest,
      );
      expect(toolSetParts.tools).toContainEqual(
        expect.objectContaining({
          function: expect.objectContaining({ name: SELF_FEEDBACK_INTENT_TOOL_NAME }),
          type: 'function',
        }),
      );
    });

    /**
     * @example
     * Calling injection twice keeps one enabled id and one LLM-visible function.
     */
    it('does not duplicate tool parts when called twice', () => {
      const toolSetParts = createToolSetParts();

      expect(injectSelfFeedbackIntentTool(toolSetParts)).toBe(true);
      expect(injectSelfFeedbackIntentTool(toolSetParts)).toBe(false);

      expect(
        toolSetParts.enabledToolIds.filter((id) => id === SELF_FEEDBACK_INTENT_IDENTIFIER),
      ).toHaveLength(1);
      expect(
        toolSetParts.tools.filter((tool) => tool.function.name === SELF_FEEDBACK_INTENT_TOOL_NAME),
      ).toHaveLength(1);
    });
  });
});
