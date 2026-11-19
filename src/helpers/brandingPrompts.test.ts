import { expect, it, vi } from 'vitest';

import { applyBrandStrings } from '@/locales/brandPostProcessor';

import { systemRoleTemplate } from '../../packages/builtin-agents/src/agents/agent-builder/systemRole';
import { systemPrompt as builder } from '../../packages/builtin-tool-agent-builder/src/systemRole';
import { buildCanvasGuide } from '../../packages/builtin-tool-canvas/src/guide';
import { CanvasManifest } from '../../packages/builtin-tool-canvas/src/manifest';
import { systemPrompt as canvas } from '../../packages/builtin-tool-canvas/src/systemRole';
import { shareVisitorSystemPrompt as sandboxShare } from '../../packages/builtin-tool-cloud-sandbox/src/systemRole';

vi.mock('@lobechat/business-const', async (original) => ({
  ...(await original<object>()),
  BRANDING_NAME: 'Private Workspace',
  EXTERNAL_INTEGRATIONS_ENABLED: false,
}));

it('does not teach builtin agents an upstream product identity', () => {
  expect(systemRoleTemplate).toContain('Private Workspace');
  expect(builder).toContain('Private Workspace');
  expect(canvas).toContain('Private Workspace');
  expect(sandboxShare).toContain('Private Workspace');
  expect(
    [
      systemRoleTemplate,
      builder,
      canvas,
      buildCanvasGuide(),
      String(CanvasManifest.meta?.description ?? ''),
      sandboxShare,
    ].join('\n'),
  ).not.toMatch(/LobeHub|LobeChat|lobehub\.com/);
});

it('replaces legacy Slack handles without inventing a private account handle', () => {
  expect(applyBrandStrings('DM @LobeHub')).toBe('DM Private Workspace');
});
