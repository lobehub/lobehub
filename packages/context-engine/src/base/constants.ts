/**
 * Shared constants for context injection
 */

/**
 * System context wrapper markers
 * Used to wrap injected context content so models can distinguish it from user content
 */
export const SYSTEM_CONTEXT_START = '<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->';
export const SYSTEM_CONTEXT_END = '<!-- END SYSTEM CONTEXT -->';

/**
 * Context instruction text
 * Provides guidance to the model on how to handle injected context
 */
export const CONTEXT_INSTRUCTION = `<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>`;
