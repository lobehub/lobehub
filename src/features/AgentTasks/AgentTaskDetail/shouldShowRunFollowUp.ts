export const shouldShowRunFollowUp = (canFollowUp: boolean, isRunning: boolean) =>
  canFollowUp && !isRunning;
