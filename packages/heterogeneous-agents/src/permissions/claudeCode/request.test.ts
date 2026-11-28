import { sanitizeAgentInterventionRequestForReview } from '@lobechat/agent-gateway-client';
import { describe, expect, it } from 'vitest';

import {
  buildClaudeCodePermissionIntervention,
  CLAUDE_CODE_PERMISSION_NOTE_KEY,
  parseClaudeCodePermissionRequest,
  resolveClaudeCodePermissionDecision,
} from './request';

// Shapes recorded from Claude Code 2.1.308 under `--permission-prompt-tool stdio`.
const writeLine = {
  request: {
    description: 'a.txt',
    display_name: 'Write',
    input: { content: 'hi', file_path: '/tmp/a.txt' },
    permission_suggestions: [{ destination: 'session', mode: 'acceptEdits', type: 'setMode' }],
    subtype: 'can_use_tool',
    tool_name: 'Write',
    tool_use_id: 'toolu_write',
  },
  request_id: 'req-1',
  type: 'control_request',
};

const exitPlanLine = {
  request: {
    display_name: 'ExitPlanMode',
    input: {
      allowedPrompts: [{ prompt: 'run tests', tool: 'Bash' }],
      plan: '# Plan\n\n1. Create b.txt',
      planFilePath: '/home/u/.claude/plans/p.md',
    },
    requires_user_interaction: true,
    subtype: 'can_use_tool',
    tool_name: 'ExitPlanMode',
    tool_use_id: 'toolu_plan',
  },
  request_id: 'req-plan',
  type: 'control_request',
};

const answer = (optionId: string, note?: string) => ({
  result: { q: optionId, ...(note && { [CLAUDE_CODE_PERMISSION_NOTE_KEY]: note }) },
});

describe('parseClaudeCodePermissionRequest', () => {
  it('reads a can_use_tool control request', () => {
    expect(parseClaudeCodePermissionRequest(writeLine)).toEqual({
      blockedPath: undefined,
      decisionReason: undefined,
      description: 'a.txt',
      displayName: 'Write',
      input: { content: 'hi', file_path: '/tmp/a.txt' },
      requestId: 'req-1',
      suggestions: [{ destination: 'session', mode: 'acceptEdits', type: 'setMode' }],
      title: undefined,
      toolName: 'Write',
      toolUseId: 'toolu_write',
    });
  });

  it('ignores other records', () => {
    expect(parseClaudeCodePermissionRequest({ type: 'assistant' })).toBeUndefined();
    expect(
      parseClaudeCodePermissionRequest({
        request: { subtype: 'interrupt' },
        request_id: 'x',
        type: 'control_request',
      }),
    ).toBeUndefined();
  });
});

describe('buildClaudeCodePermissionIntervention', () => {
  it('raises a permission card a durable review accepts', () => {
    const request = parseClaudeCodePermissionRequest(writeLine)!;
    const intervention = buildClaudeCodePermissionIntervention(request);

    expect(intervention.toolCallId).toBe('cc-permission-req-1');
    expect(intervention.interactionKind).toBe('permission');
    expect(intervention.arguments.questions[0].options.map((o) => o.id)).toEqual([
      'allow',
      'allow_session',
      'deny',
    ]);
    expect(
      sanitizeAgentInterventionRequestForReview({
        apiName: 'askUserQuestion',
        arguments: JSON.stringify(intervention.arguments),
        deadline: Date.now() + 1000,
        identifier: 'claude-code',
        interactionKind: intervention.interactionKind,
        provider: 'claude-code',
        toolCallId: intervention.toolCallId,
      }),
    ).toBeDefined();
  });

  it('offers no session-wide allow without suggestions', () => {
    const request = parseClaudeCodePermissionRequest({
      ...writeLine,
      request: { ...writeLine.request, permission_suggestions: undefined },
    })!;
    expect(
      buildClaudeCodePermissionIntervention(request).arguments.claudeCodePermission.options,
    ).toEqual(['allow', 'deny']);
  });

  it('raises a plan card with the plan and the requested prompts', () => {
    const intervention = buildClaudeCodePermissionIntervention(
      parseClaudeCodePermissionRequest(exitPlanLine)!,
    );
    expect(intervention.interactionKind).toBe('plan');
    expect(intervention.arguments.claudeCodePermission).toMatchObject({
      allowedPrompts: [{ prompt: 'run tests', tool: 'Bash' }],
      kind: 'exitPlan',
      options: ['approve_bypass', 'approve_accept_edits', 'approve_default', 'keep_planning'],
      plan: '# Plan\n\n1. Create b.txt',
    });
    expect(intervention.arguments.questions[0].question).toBe('# Plan\n\n1. Create b.txt');
  });

  it('hides "don\'t ask again" as root', () => {
    const intervention = buildClaudeCodePermissionIntervention(
      parseClaudeCodePermissionRequest(exitPlanLine)!,
      { isRoot: true },
    );
    expect(intervention.arguments.claudeCodePermission.options).not.toContain('approve_bypass');
  });

  it('asks to enter plan mode with allow / deny', () => {
    const intervention = buildClaudeCodePermissionIntervention(
      parseClaudeCodePermissionRequest({
        ...writeLine,
        request: { ...writeLine.request, input: {}, tool_name: 'EnterPlanMode' },
      })!,
    );
    expect(intervention.interactionKind).toBe('permission');
    expect(intervention.arguments.claudeCodePermission).toMatchObject({
      kind: 'enterPlan',
      options: ['allow', 'deny'],
    });
  });

  it('cuts long input strings in the preview', () => {
    const request = parseClaudeCodePermissionRequest({
      ...writeLine,
      request: { ...writeLine.request, input: { content: 'x'.repeat(5000), file_path: '/a' } },
    })!;
    const preview = buildClaudeCodePermissionIntervention(request).arguments.claudeCodePermission
      .input!.content as string;
    expect(preview.length).toBe(2000);
  });
});

describe('resolveClaudeCodePermissionDecision', () => {
  const write = parseClaudeCodePermissionRequest(writeLine)!;
  const plan = parseClaudeCodePermissionRequest(exitPlanLine)!;

  it('allows with the original input', () => {
    expect(resolveClaudeCodePermissionDecision(write, answer('allow'))).toEqual({
      behavior: 'allow',
      updatedInput: write.input,
    });
  });

  it('always-allow applies the suggestions to this session only', () => {
    const request = {
      ...write,
      suggestions: [
        {
          behavior: 'allow',
          destination: 'localSettings',
          rules: [{ toolName: 'Bash' }],
          type: 'addRules',
        },
      ],
    };
    expect(resolveClaudeCodePermissionDecision(request, answer('allow_session'))).toEqual({
      behavior: 'allow',
      updatedInput: write.input,
      updatedPermissions: [
        {
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'Bash' }],
          type: 'addRules',
        },
      ],
    });
  });

  it('denies and interrupts without a note, carries on with one', () => {
    expect(resolveClaudeCodePermissionDecision(write, answer('deny'))).toEqual({
      behavior: 'deny',
      interrupt: true,
      message: 'The user denied this.',
    });
    expect(resolveClaudeCodePermissionDecision(write, answer('deny', 'use b.txt'))).toEqual({
      behavior: 'deny',
      message: 'The user denied this: use b.txt',
    });
  });

  it.each([
    ['approve_bypass', 'bypassPermissions'],
    ['approve_accept_edits', 'acceptEdits'],
    ['approve_default', 'default'],
  ])('%s approves the plan and switches to %s', (option, mode) => {
    expect(resolveClaudeCodePermissionDecision(plan, answer(option))).toEqual({
      behavior: 'allow',
      updatedInput: plan.input,
      updatedPermissions: [{ destination: 'session', mode, type: 'setMode' }],
    });
  });

  it('keep planning denies with the feedback', () => {
    expect(resolveClaudeCodePermissionDecision(plan, answer('keep_planning', 'add tests'))).toEqual(
      {
        behavior: 'deny',
        message: 'The user wants to keep planning. Revise the plan: add tests',
      },
    );
  });

  it('refuses bypass as root even if the answer names it', () => {
    expect(
      resolveClaudeCodePermissionDecision(plan, answer('approve_bypass'), { isRoot: true }),
    ).toMatchObject({ behavior: 'deny', interrupt: true });
  });

  it('denies and interrupts when the card ends unanswered', () => {
    expect(
      resolveClaudeCodePermissionDecision(write, {
        cancelReason: 'user_cancelled',
        cancelled: true,
      }),
    ).toEqual({
      behavior: 'deny',
      interrupt: true,
      message: 'The user stopped the run before answering.',
    });
  });
});
