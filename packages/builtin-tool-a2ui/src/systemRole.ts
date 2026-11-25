import { buildA2uiPrompt } from '@lobehub/a2ui';

/**
 * What an Agent is told about drawing a card. LobeHub only says when a card helps and its product
 * rules; the components, their props and the protocol come from `@lobehub/a2ui`, which generates
 * them from the catalog's JSON Schema the way the official A2UI prompt generator does, with
 * examples of differently shaped cards. So the prompt always matches what the installed package
 * validates and draws, and never prescribes one card layout.
 */
const PRODUCT_RULES = `You can answer with a card instead of, or next to, text: call renderUI with A2UI 1.0 messages for one surface. It renders in the conversation, in the product's own design, for everyone in it.

WHEN A CARD HELPS
- Display (the common case): information a person takes in at a glance: reports, digests, status reviews, metrics, trends, rankings, comparisons, schedules, plans, profiles, recipes, incident summaries. Here the card is the answer.
- Input: asking for several inputs at once (choices, numbers, dates, short text). A single yes/no question is plain text.
- Not for prose, explanations, or anything a few sentences answer. Never wrap ordinary text in a card.
- One card per answer. Put a sentence of text before it only if it adds something; for a report, the card alone is usually enough.
- A card goes out with your answer, where you are answering. To put a card somewhere else (another Thread, the Channel's main timeline, another Channel), draw it, then post it with lobe-channel postMessage.

PRODUCT RULES
- Design each card for its content. Two different requests should rarely produce the same structure; choose components by the shape of the information, not a habit.
- A display card needs no buttons. Add a Button only for a real next step the person would take right now and that you can carry out when they click it; never add "OK", "Got it", "Details" or "Let me know" buttons. Links to full reports belong in Text as markdown links.
- At most one primary Button per card; put buttons in a Row with justify "end" at the bottom.
- When the person clicks a button, you receive its event name and its context as their next message. To send what they filled in, bind it in the context: "action": {"event": {"name": "submit", "context": {"prefs": {"@path": "/prefs"}}}}.
- Show only figures you were given or measured. If something is an estimate or an example, say so on the card.`;

export const systemPrompt = `<a2ui_guide>
${PRODUCT_RULES}

${buildA2uiPrompt()}
</a2ui_guide>`;
