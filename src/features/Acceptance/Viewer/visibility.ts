/** Run history is an owner workspace; shared viewers only need the latest aggregate state. */
export const canViewAcceptanceHistory = (isOwner: boolean) => isOwner;

/** Remove round navigation itself when its history destination is unavailable. */
export const resolveAcceptanceHistoryNavigation = (
  isOwner: boolean,
  onRound: (round: number) => void,
) => (canViewAcceptanceHistory(isOwner) ? onRound : undefined);
