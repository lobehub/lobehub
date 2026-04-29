import debug from 'debug';

import { BaseVirtualLastUserContentProvider } from '../base/BaseVirtualLastUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';
import type { OnboardingContextInjectorConfig } from './OnboardingContextInjector';

const log = debug('context-engine:provider:OnboardingActionHintInjector');

/**
 * Onboarding Action Hint Injector
 * Injects a standalone virtual user message AFTER the last user message with phase-specific
 * tool call directives. This is a separate message (not appended to the user's message)
 * so the model treats it as a distinct instruction rather than part of the user's input.
 */
export class OnboardingActionHintInjector extends BaseVirtualLastUserContentProvider {
  readonly name = 'OnboardingActionHintInjector';

  constructor(
    private config: OnboardingContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected shouldSkip(_context: PipelineContext): boolean {
    if (!this.config.enabled || !this.config.onboardingContext?.phaseGuidance) {
      log('Disabled or no phaseGuidance configured, skipping');
      return true;
    }
    return false;
  }

  protected buildContent(context: PipelineContext): string | null {
    const ctx = this.config.onboardingContext;
    if (!ctx) return null;

    const hints: string[] = [];
    const phase = ctx.phaseGuidance;
    // Detect prior showAgentMarketplace calls. NOTE: this provider runs in pipeline phase 4.5
    // (virtual tail guidance) BEFORE ToolCallProcessor converts the DB-shape `tools` array
    // into OpenAI-shape `tool_calls`. So at injection time, assistant messages still carry
    // `tools: [{ identifier, apiName, ... }]`, not `tool_calls`. Match on apiName here, with
    // a `tool_calls` fallback in case ordering changes.
    const isMarketplaceShowCall = (msg: any): boolean => {
      if (msg?.role !== 'assistant') return false;
      if (
        Array.isArray(msg.tools) &&
        msg.tools.some(
          (t: any) =>
            t?.apiName === 'showAgentMarketplace' || t?.identifier === 'lobe-agent-marketplace',
        )
      ) {
        return true;
      }
      if (Array.isArray(msg.tool_calls)) {
        return msg.tool_calls.some(
          (tc: any) =>
            typeof tc?.function?.name === 'string' &&
            tc.function.name.includes('showAgentMarketplace'),
        );
      }
      return false;
    };
    const marketplaceAlreadyOpened = context.messages.some((msg) => isMarketplaceShowCall(msg));

    // Detect empty documents and nudge tool calls (empty docs use writeDocument; non-empty use updateDocument)
    if (!ctx.soulContent) {
      hints.push(
        'SOUL.md is empty — call writeDocument(type="soul") to write the initial agent identity once the user gives you a name and emoji.',
      );
    }
    if (!ctx.personaContent) {
      hints.push(
        'User Persona is empty — call writeDocument(type="persona") to seed the initial persona once you have learned something about the user.',
      );
    }

    // Phase-specific persistence reminders
    if (phase.includes('Agent Identity')) {
      hints.push(
        'When the user settles on a name and emoji: call saveUserQuestion with agentName and agentEmoji, then persist SOUL.md. If SOUL.md is already non-empty, call updateDocument(type="soul") with the hunk mode that matches your edit — `insertAt`/`replaceLines`/`deleteLines` when you can read the line numbers from <current_soul_document>, or `replace` for a textual tweak. If empty, use writeDocument(type="soul") for the initial write.',
      );
    } else if (phase.includes('User Identity')) {
      hints.push(
        'THIS TURN, as soon as the user tells you their name, call saveUserQuestion with fullName — do NOT wait until you also know their role. Persist the name immediately.',
      );
      hints.push(
        'Seed the persona document the moment you have ANY useful fact about the user (just a name, just a role, or both). If empty, call writeDocument(type="persona") with a short initial draft containing whatever you know so far (even one line). If already non-empty, call updateDocument(type="persona") with `insertAt` at the end of the right section (use `line = totalLines + 1` to append) or `replace` for a textual tweak. Do NOT defer persistence until more facts arrive.',
      );
    } else if (phase.includes('Discovery')) {
      hints.push(
        'Each turn where you learn a new fact (pain point, goal, preference, workflow detail, interest), call updateDocument(type="persona") BEFORE replying. Preferred shape: `{ mode: "insertAt", line: <line shown in <current_user_persona>>, content: "- new fact" }`. This is the default every turn — not an end-of-phase action. Do NOT save facts only in memory waiting for a final full write. After sufficient discovery (5-6 exchanges), also call saveUserQuestion with interests and responseLanguage. Use writeDocument(type="persona") only if the document is still empty.',
      );
      hints.push(
        'EARLY EXIT: A true early-exit signal is the user explicitly wanting to END onboarding (e.g., "我累了", "我先走", "下次再聊", "没空", "暂时不弄了", "结束吧", "Thanks, that\'s enough", "I have to go"). Short affirmations like "好的" / "行" / "嗯" / "ok" are NOT early-exit signals — they confirm what you just said and you should keep exploring or move toward summary normally. When you see a real exit signal: stop exploring, save whatever fields you have (call saveUserQuestion with interests even if partial), present a brief summary, then call `showAgentMarketplace` and only after it resolves call `finishOnboarding`. Do NOT skip the marketplace step unless the user explicitly cancels/skips the picker.',
      );
    } else if (phase.includes('Summary')) {
      if (!marketplaceAlreadyOpened) {
        hints.push(
          'Present a summary, then THIS TURN call `showAgentMarketplace` exactly once with `{ requestId, categoryHints, prompt }` — pick 1–3 MarketplaceCategory slugs from what you learned in discovery. The picker is the required handoff that lets the user choose recommended assistants; do NOT skip it on normal completion. After the showAgentMarketplace tool result comes back, **STOP this turn** — no more tool calls and no closing text yet. The picker resolves directly via the tool result UI (the user will pick / skip in place); when it resolves, the runtime will start a NEW assistant turn whose tool result describes what was picked. The closing + `finishOnboarding` belong to that next turn.',
        );
      } else {
        hints.push(
          'You have ALREADY opened the marketplace picker this conversation, and the user has just resolved it through the picker UI — the latest tool result describes what was picked (look for `installedAgentIds` / `selectedTemplateIds`, or a `skipped`/`cancelled` status). Do NOT call `showAgentMarketplace` again, do NOT claim you just opened the list, and do NOT wait for another user message. THIS TURN: (1) briefly acknowledge the picks (or the skip/cancel) in 1–2 sentences; (2) call `updateDocument(type="persona")` with `insertAt` mode to record the picks (categories/use cases) so future sessions remember; (3) call `finishOnboarding`. If the tool result indicates skip/cancel, skip step 2 and just close + `finishOnboarding`.',
        );
      }
    }

    hints.push(
      'PERSISTENCE RULE: Call the persistence tools (saveUserQuestion, writeDocument, updateDocument) to save information as you collect it — simply acknowledging in conversation is NOT enough. For document writes: use writeDocument only for the first write when the document is empty; for every subsequent edit use updateDocument with the appropriate hunk mode (`insertAt` / `replaceLines` / `deleteLines` for line-based edits, `replace` / `delete` for byte-exact textual edits). The injected <current_*_document> view shows each line prefixed with its 1-based number and `→` — use those numbers for line-based hunks.',
    );
    hints.push(
      'CONFIRMATION vs EARLY EXIT: Short replies like "好的" / "行" / "嗯" / "ok" / "可以" / "好" are CONFIRMATIONS, not early-exit signals. Continue the current phase normally — in Summary that means calling `showAgentMarketplace` next, NOT `finishOnboarding` directly.',
    );
    if (
      phase.includes('Agent Identity') ||
      phase.includes('User Identity') ||
      phase.includes('Discovery')
    ) {
      hints.push(
        'EARLY EXIT REMINDER: A true early-exit signal means the user explicitly wants the onboarding to END — examples: "我累了", "我先走", "下次再聊", "没空", "暂时不弄了", "结束吧", "Thanks, that\'s enough", "I have to go". When you see one (and only then), persist any unsaved fields, give a brief summary, then call `showAgentMarketplace` once and only after the picker resolves call `finishOnboarding`. Skip the picker only if the user explicitly refuses it in words ("不用推荐", "别给我装东西", "skip the picker"); a generic exit signal is NOT a refusal of the picker.',
      );
    }

    return `<next_actions>\n${hints.join('\n')}\n</next_actions>`;
  }

  /**
   * Override: always create a standalone virtual user message instead of appending
   * to the last user message. This keeps the action hints visually and semantically
   * separate from the user's actual input.
   */
  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.shouldSkip(context)) {
      return this.markAsExecuted(context);
    }

    const content = this.buildContent(context);
    if (!content) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    clonedContext.messages.push(this.createVirtualLastUserMessage(content));

    return this.markAsExecuted(clonedContext);
  }
}
