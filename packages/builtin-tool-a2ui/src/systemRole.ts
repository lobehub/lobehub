import { getA2uiProcessor } from '@lobehub/a2ui';

/**
 * What an Agent is told while the card tool is active: the processor's prompt snippet from
 * `@lobehub/a2ui` (a short product layer, the A2UI format rules, the catalog schemas and examples),
 * so a dependency bump carries every change. Where a card goes in a Channel is lobe-channel's to say.
 */
export const systemPrompt = getA2uiProcessor().promptSnippet;
