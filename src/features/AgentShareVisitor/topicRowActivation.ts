/**
 * Whether a `KeyboardEvent.key` should activate a visitor topic row.
 *
 * Extracted so the div-as-button keyboard semantics (mirroring a native
 * `<button>`: only Enter/Space activate) are unit-testable without rendering
 * `TopicPanel` — see `topicRowActivation.test.ts`.
 */
export const isTopicRowActivationKey = (key: string): boolean => key === 'Enter' || key === ' ';
