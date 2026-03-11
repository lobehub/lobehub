/* eslint-disable unused-imports/no-unused-vars */
import { type ReferralStatusString } from '@lobechat/types';
import { Plans } from '@lobechat/types';

export async function getReferralStatus(userId: string): Promise<ReferralStatusString | undefined> {
  return undefined;
}

export async function getSubscriptionPlan(userId: string): Promise<Plans> {
  return Plans.Free;
}

export async function initNewUserForBusiness(
  userId: string,
  createdAt: Date | null | undefined,
): Promise<void> {}
