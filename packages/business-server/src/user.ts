import type { ReferralStatusString } from '@lobechat/types';
import { Plans } from '@lobechat/types';

export interface OnUserActivityForBusinessParams {
  currentTime: Date;
  previousLastActiveAt: Date;
  userCreatedAt: Date;
  userId: string;
}

export async function getReferralStatus(
  _userId: string,
): Promise<ReferralStatusString | undefined> {
  return undefined;
}

export async function getSubscriptionPlan(_userId: string): Promise<Plans> {
  return Plans.Free;
}

export async function initNewUserForBusiness(
  _userId: string,
  _createdAt: Date | null | undefined,
): Promise<void> {}

export async function onUserActivityForBusiness(
  _params: OnUserActivityForBusinessParams,
): Promise<void> {}
