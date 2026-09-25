/**
 * The popup ↔ review-toolbar handshake. The toolbar — the embeddable review
 * SDK, maintained outside this repository — opens
 * `/oauth/acceptance-review?acceptance=<id>&origin=<its origin>`; once the
 * reviewer approves, this page posts ONE message to `window.opener`, targeted at
 * exactly that origin, then closes. Keep the type string in sync with the SDK.
 */
export const ACCEPTANCE_REVIEW_SESSION_MESSAGE = 'lobehub:acceptance-review:session';
export const ACCEPTANCE_REVIEW_DENIED_MESSAGE = 'lobehub:acceptance-review:denied';
