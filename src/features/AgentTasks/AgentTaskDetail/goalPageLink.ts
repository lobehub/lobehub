/**
 * Whether this bundle registers the agent-less `/goal/:goalId` page. The mobile
 * router does not, and it is chosen by the bundle (`entry.mobile.tsx`), not by the
 * viewport — a landscape phone above the mobile breakpoint is still the mobile
 * router. Read per call so a test can stub `__MOBILE__`.
 */
export const hasGoalPage = () => !(typeof __MOBILE__ !== 'undefined' && __MOBILE__);
