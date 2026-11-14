export interface BusinessPreciseSchedule {
  /** Whether a task schedule may pick any exact minute, not only :00 / :30. */
  allowed: boolean;
  /** Opens the deployment's upgrade flow from the locked custom-minute option. */
  onUpgrade?: () => void;
}

/**
 * Lets a deployment reserve custom exact schedule times for some plans. The
 * default offers them to everyone.
 */
export const useBusinessPreciseSchedule = (): BusinessPreciseSchedule => ({ allowed: true });
