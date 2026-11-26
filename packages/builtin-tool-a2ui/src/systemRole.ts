import { A2UI_SYSTEM_PROMPT } from '@lobehub/a2ui/systemPrompt';

/**
 * What an Agent is told while the card tool is active: the processor's prompt snippet from
 * `@lobehub/a2ui` (a short product layer, the A2UI format rules, the catalog schemas and examples),
 * shipped pre-generated so the tool manifest doesn't bundle the schemas and validator, and a
 * dependency bump carries every change. Where a card goes in a Channel is lobe-channel's to say.
 */
export const systemPrompt = A2UI_SYSTEM_PROMPT;
