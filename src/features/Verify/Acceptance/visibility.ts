/** Run history is an owner workspace; shared viewers only need the latest aggregate state. */
export const canViewAcceptanceHistory = (isOwner: boolean) => isOwner;
