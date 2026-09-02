/** Run history is an owner workspace; shared viewers only need the latest aggregate state. */
export const canViewAcceptanceHistory = (isOwner: boolean) => isOwner;

/** Remove round navigation itself when its history destination is unavailable. */
export const resolveAcceptanceHistoryNavigation = (
  isOwner: boolean,
  onRound: (round: number) => void,
) => (canViewAcceptanceHistory(isOwner) ? onRound : undefined);

/**
 * Whether the viewer may act on the checks (accept / reject / ignore, group
 * feedback, proposal adjudication).
 *
 * The server decides this — it is the creator OR an owner of the acceptance's
 * workspace, exactly what the write path enforces — so the client must not
 * re-derive it from `isOwner`. Reading it off the bundle rather than taking it
 * from the host is what keeps a shared link from rendering live controls whose
 * every click answers "Acceptance not found"; deriving it from ownership alone
 * is what locked a workspace owner out of a teammate's delivery.
 */
export const canReviewAcceptance = (
  bundle?: { canReview?: boolean; isOwner?: boolean } | null,
) =>
  Boolean(bundle?.canReview);
