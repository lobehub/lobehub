/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AskUserQuestionArgs } from './types';
import { useAskUserForm } from './useAskUserForm';

const singleQuestionArgs: AskUserQuestionArgs = {
  questions: [
    {
      header: 'Scope',
      options: [{ label: 'Narrow' }, { label: 'Full' }],
      question: 'How broad?',
    },
  ],
};

const twoQuestionArgs: AskUserQuestionArgs = {
  questions: [
    {
      header: 'Scope',
      options: [{ label: 'Narrow' }, { label: 'Full' }],
      question: 'How broad?',
    },
    {
      header: 'Mode',
      options: [{ label: 'Auto' }, { label: 'Manual' }],
      question: 'Which mode?',
    },
  ],
};

const setup = (args: AskUserQuestionArgs, persistedDraft?: unknown) => {
  const onInteractionAction = vi.fn().mockResolvedValue(undefined);
  const writeDraft = vi.fn();
  const hook = renderHook(() =>
    useAskUserForm({
      args,
      onInteractionAction,
      persistedDraft,
      writeDraft,
    }),
  );
  return { hook, onInteractionAction, writeDraft };
};

describe('useAskUserForm select-to-submit', () => {
  it('displays labels but submits stable option ids', () => {
    const args: AskUserQuestionArgs = {
      questions: [
        {
          header: 'Permission',
          options: [
            { id: 'allow-once', label: 'Continue' },
            { id: 'reject-once', label: 'Continue' },
          ],
          question: 'Edit README?',
        },
      ],
    };
    const { hook, onInteractionAction } = setup(args);

    act(() => hook.result.current.handleToggle(args.questions[0], 'reject-once'));
    act(() => hook.result.current.handleSubmit());

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: { 'Edit README?': 'reject-once' },
      type: 'submit',
    });
  });

  it('submits immediately when a keyboard single-select pick completes the form', () => {
    const { hook, onInteractionAction } = setup(singleQuestionArgs);

    act(() => {
      hook.result.current.handleToggle(singleQuestionArgs.questions[0], 'Full', {
        submitOnComplete: true,
      });
    });

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: { 'How broad?': 'Full' },
      type: 'submit',
    });
  });

  it('never submits on a plain (mouse-click) toggle, even when it completes the form', () => {
    // Regression: clicking an option must only select it — accidental clicks
    // were submitting the whole form when select-to-submit applied to clicks.
    const { hook, onInteractionAction } = setup(singleQuestionArgs);

    act(() => {
      hook.result.current.handleToggle(singleQuestionArgs.questions[0], 'Full');
    });

    expect(onInteractionAction).not.toHaveBeenCalled();
    expect(hook.result.current.picks['How broad?']).toBe('Full');

    act(() => {
      hook.result.current.handleSubmit();
    });

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: { 'How broad?': 'Full' },
      type: 'submit',
    });
  });

  it('auto-advances instead of submitting while other questions are unanswered', () => {
    const { hook, onInteractionAction } = setup(twoQuestionArgs);

    act(() => {
      hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow', {
        submitOnComplete: true,
      });
    });

    expect(onInteractionAction).not.toHaveBeenCalled();
    expect(hook.result.current.activeTab).toBe('1');

    act(() => {
      hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto', {
        submitOnComplete: true,
      });
    });

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: { 'How broad?': 'Narrow', 'Which mode?': 'Auto' },
      type: 'submit',
    });
  });

  it('never auto-submits when revisiting an already-answered question', () => {
    // Resumed draft with every question answered — changing a pick must stay a
    // review edit, not a surprise submit.
    const { hook, onInteractionAction } = setup(twoQuestionArgs, {
      picks: { 'How broad?': 'Narrow', 'Which mode?': 'Auto' },
    });

    act(() => {
      hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Full', {
        submitOnComplete: true,
      });
    });

    expect(onInteractionAction).not.toHaveBeenCalled();
    expect(hook.result.current.picks['How broad?']).toBe('Full');
  });

  it('keeps multi-select on explicit submit even when the toggle answers everything', () => {
    const args: AskUserQuestionArgs = {
      questions: [
        {
          header: 'Scope',
          multiSelect: true,
          options: [{ label: 'Narrow' }, { label: 'Full' }],
          question: 'How broad?',
        },
      ],
    };
    const { hook, onInteractionAction } = setup(args);

    act(() => {
      hook.result.current.handleToggle(args.questions[0], 'Narrow', { submitOnComplete: true });
    });

    expect(onInteractionAction).not.toHaveBeenCalled();

    act(() => {
      hook.result.current.handleSubmit();
    });

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: { 'How broad?': ['Narrow'] },
      type: 'submit',
    });
  });

  it('keeps a resolving form visible but disables edits and resubmission', () => {
    const onInteractionAction = vi.fn();
    const hook = renderHook(() =>
      useAskUserForm({
        args: singleQuestionArgs,
        disabled: true,
        onInteractionAction,
        persistedDraft: undefined,
        writeDraft: vi.fn(),
      }),
    );

    act(() => hook.result.current.handleToggle(singleQuestionArgs.questions[0], 'Full'));
    act(() => hook.result.current.handleSubmit());

    expect(hook.result.current.picks).toEqual({});
    expect(hook.result.current.isSubmitDisabled).toBe(true);
    expect(hook.result.current.submitting).toBe(true);
    expect(onInteractionAction).not.toHaveBeenCalled();
  });
});

describe('useAskUserForm additional notes', () => {
  it('allows additional notes on a single-question prompt', () => {
    const { hook, onInteractionAction } = setup(singleQuestionArgs);

    act(() => hook.result.current.handleToggle(singleQuestionArgs.questions[0], 'Full'));
    act(() => hook.result.current.setSupplementMode(true));
    act(() => hook.result.current.handleSupplementTextChange('One-question context.'));
    act(() => hook.result.current.handleSubmit());

    expect(hook.result.current.supplementActive).toBe(true);
    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: {
        'How broad?': 'Full',
        '__supplement__': 'One-question context.',
      },
      type: 'submit',
    });
  });

  it('keeps structured answers and appends additional notes', () => {
    const { hook, onInteractionAction } = setup(twoQuestionArgs);

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow'));
    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto'));
    act(() => hook.result.current.setSupplementMode(true));
    act(() => hook.result.current.handleSupplementTextChange('Keep existing behavior.'));
    act(() => hook.result.current.handleSubmit());

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: {
        'How broad?': 'Narrow',
        'Which mode?': 'Auto',
        '__supplement__': 'Keep existing behavior.',
      },
      type: 'submit',
    });
  });

  it('requires both complete answers and non-empty notes in additional-notes mode', () => {
    const { hook } = setup(twoQuestionArgs);

    act(() => hook.result.current.setSupplementMode(true));
    expect(hook.result.current.isSubmitDisabled).toBe(true);

    act(() => hook.result.current.handleSupplementTextChange('More context'));
    expect(hook.result.current.isSubmitDisabled).toBe(true);

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow'));
    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto'));
    expect(hook.result.current.isSubmitDisabled).toBe(false);
  });

  it('keeps replace-all and additional-notes modes mutually exclusive', () => {
    const { hook } = setup(twoQuestionArgs);

    act(() => hook.result.current.setSupplementMode(true));
    expect(hook.result.current.supplementActive).toBe(true);
    expect(hook.result.current.escapeActive).toBe(false);

    act(() => hook.result.current.setEscapeMode(true));
    expect(hook.result.current.supplementActive).toBe(false);
    expect(hook.result.current.escapeActive).toBe(true);
  });

  it('restores additional-notes drafts without losing selected answers', () => {
    const { hook } = setup(twoQuestionArgs, {
      picks: { 'How broad?': 'Full', 'Which mode?': 'Manual' },
      supplementActive: true,
      supplementText: 'Preserve this note',
    });

    expect(hook.result.current.picks).toEqual({
      'How broad?': 'Full',
      'Which mode?': 'Manual',
    });
    expect(hook.result.current.supplementActive).toBe(true);
    expect(hook.result.current.supplementText).toBe('Preserve this note');
    expect(hook.result.current.isSubmitDisabled).toBe(false);
  });

  it('persists one atomic snapshot when returning from replace-all to a question', () => {
    const { hook, writeDraft } = setup(twoQuestionArgs);

    act(() => hook.result.current.setEscapeMode(true));
    act(() => hook.result.current.setQuestionMode('0'));

    expect(hook.result.current.escapeActive).toBe(false);
    expect(hook.result.current.supplementActive).toBe(false);
    expect(writeDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ escapeActive: false, supplementActive: false }),
    );
  });

  it('includes existing notes in keyboard select-to-submit', () => {
    const { hook, onInteractionAction } = setup(twoQuestionArgs);

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow'));
    act(() => hook.result.current.setSupplementMode(true));
    act(() => hook.result.current.handleSupplementTextChange('Keep this note.'));
    act(() => hook.result.current.setQuestionMode('1'));
    act(() =>
      hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto', {
        submitOnComplete: true,
      }),
    );

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: {
        'How broad?': 'Narrow',
        'Which mode?': 'Auto',
        '__supplement__': 'Keep this note.',
      },
      type: 'submit',
    });
  });

  it('includes saved notes on explicit submit after returning to a question', () => {
    const { hook, onInteractionAction } = setup(twoQuestionArgs);

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow'));
    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto'));
    act(() => hook.result.current.setSupplementMode(true));
    act(() => hook.result.current.handleSupplementTextChange('Keep this saved note.'));
    act(() => hook.result.current.setQuestionMode('0'));
    act(() => hook.result.current.handleSubmit());

    expect(hook.result.current.supplementActive).toBe(false);
    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: {
        'How broad?': 'Narrow',
        'Which mode?': 'Auto',
        '__supplement__': 'Keep this saved note.',
      },
      type: 'submit',
    });
  });

  it('includes saved notes in the timeout fallback after returning to a question', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
    const onInteractionAction = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useAskUserForm({
        args: twoQuestionArgs,
        countdownMs: 1000,
        onInteractionAction,
        persistedDraft: undefined,
        writeDraft: vi.fn(),
      }),
    );

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Full'));
    act(() => hook.result.current.setSupplementMode(true));
    act(() => hook.result.current.handleSupplementTextChange('Keep this timeout note.'));
    act(() => hook.result.current.setQuestionMode('1'));
    act(() => vi.advanceTimersByTime(1000));

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: {
        'How broad?': 'Full',
        'Which mode?': 'Auto',
        '__supplement__': 'Keep this timeout note.',
      },
      type: 'submit',
    });

    hook.unmount();
    vi.useRealTimers();
  });

  it('never selects the first provider-owned option when the countdown expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
    const onInteractionAction = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useAskUserForm({
        args: {
          questions: [
            {
              header: 'Permission',
              options: [
                { id: 'allow-once', label: 'Allow' },
                { id: 'deny', label: 'Deny' },
              ],
              question: 'Run command?',
            },
          ],
        },
        countdownMs: 1000,
        onInteractionAction,
        persistedDraft: undefined,
        writeDraft: vi.fn(),
      }),
    );

    act(() => vi.advanceTimersByTime(1000));

    expect(onInteractionAction).not.toHaveBeenCalled();
    hook.unmount();
    vi.useRealTimers();
  });
});

describe('useAskUserForm producer deadline', () => {
  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;

  const renderWithDeadline = (deadlineAt: number | undefined, onInteractionAction: unknown) =>
    renderHook(() =>
      useAskUserForm({
        args: twoQuestionArgs,
        countdownMs: 10 * MINUTE,
        deadlineAt,
        onInteractionAction: onInteractionAction as never,
        persistedDraft: undefined,
        writeDraft: vi.fn(),
      }),
    );

  it('tracks the producer deadline instead of restarting the countdown on mount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
    // Card mounts 9 minutes into a 10-minute producer window (a refresh, a tab
    // switch, or simply opening the topic late): only 1 minute is left, not 10.
    const deadlineAt = Date.now() + MINUTE;
    const hook = renderWithDeadline(deadlineAt, vi.fn().mockResolvedValue(undefined));

    expect(hook.result.current.remainingMs).toBeLessThanOrEqual(MINUTE);
    expect(hook.result.current.expired).toBe(false);

    act(() => vi.advanceTimersByTime(MINUTE));
    expect(hook.result.current.expired).toBe(true);

    hook.unmount();
    vi.useRealTimers();
  });

  it('leaves the user their answering time and only auto-answers in the last seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
    const onInteractionAction = vi.fn().mockResolvedValue(undefined);
    const deadlineAt = Date.now() + MINUTE;
    const hook = renderWithDeadline(deadlineAt, onInteractionAction);

    // Ten seconds left is still the user's time to answer — nothing may be
    // submitted on their behalf yet.
    act(() => vi.advanceTimersByTime(MINUTE - 10_000));
    expect(onInteractionAction).not.toHaveBeenCalled();
    expect(hook.result.current.autoSubmitted).toBe(false);

    // Inside the last few seconds the fallback answers, still early enough that
    // the producer's bridge is listening.
    act(() => vi.advanceTimersByTime(6000));

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: { 'How broad?': 'Narrow', 'Which mode?': 'Auto' },
      type: 'submit',
    });
    expect(hook.result.current.autoSubmitted).toBe(true);
    expect(Date.now()).toBeLessThan(deadlineAt);

    hook.unmount();
    vi.useRealTimers();
  });

  it('never auto-submits into a producer that already gave up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
    const onInteractionAction = vi.fn().mockResolvedValue(undefined);
    // The producer's bridge timed out an hour ago; anything published now can
    // never be acknowledged and would freeze the card on `resolving`.
    const hook = renderWithDeadline(Date.now() - HOUR, onInteractionAction);

    // Well past the mount-relative countdown the card used to restart from.
    act(() => vi.advanceTimersByTime(15 * MINUTE));

    expect(onInteractionAction).not.toHaveBeenCalled();
    expect(hook.result.current.expired).toBe(true);
    // The footer must not promise an answer that is never going to be sent.
    expect(hook.result.current.autoSubmitted).toBe(false);

    hook.unmount();
    vi.useRealTimers();
  });

  it('does not re-offer an answered question while the host is still settling it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
    const onInteractionAction = vi.fn().mockResolvedValue(undefined);
    const hook = renderWithDeadline(Date.now() + 10 * MINUTE, onInteractionAction);

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow'));
    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto'));
    await act(async () => {
      hook.result.current.handleSubmit();
    });

    // Publishing is only transport acceptance — the card waits.
    expect(hook.result.current.submitting).toBe(true);

    // The host settles the card at its own 30s budget and takes it off screen.
    // The form must NOT hand the buttons back at that moment: the question is
    // answered, and re-offering it invites a duplicate answer.
    await act(async () => {
      vi.advanceTimersByTime(31 * 1000);
    });
    expect(hook.result.current.submitting).toBe(true);
    expect(hook.result.current.isSubmitDisabled).toBe(true);

    hook.unmount();
    vi.useRealTimers();
  });

  it('releases the latch only as a floor, when nothing ever settled the card', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
    const onInteractionAction = vi.fn().mockResolvedValue(undefined);
    const hook = renderWithDeadline(Date.now() + 10 * MINUTE, onInteractionAction);

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow'));
    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto'));
    await act(async () => {
      hook.result.current.handleSubmit();
    });

    await act(async () => {
      vi.advanceTimersByTime(46 * 1000);
    });

    expect(hook.result.current.submitting).toBe(false);

    hook.unmount();
    vi.useRealTimers();
  });
});
