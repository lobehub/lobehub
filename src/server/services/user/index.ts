 
import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { type UserJSON } from '@clerk/backend';
import { type LobeChatDatabase } from '@lobechat/database';

import { initNewUserForBusiness } from '@/business/server/user';
import { UserModel } from '@/database/models/user';
import { initializeServerAnalytics } from '@/libs/analytics';
import { pino } from '@/libs/logger';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { FileS3 } from '@/server/modules/S3';

type CreatedUser = {
  createdAt?: Date | null;
  email?: string | null;
  firstName?: string | null;
  id: string;
  lastName?: string | null;
  phone?: string | null;
  username?: string | null;
};

export class UserService {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  async initUser(user: CreatedUser) {
    if (ENABLE_BUSINESS_FEATURES) {
      try {
        await initNewUserForBusiness(user.id, user.createdAt);
      } catch (error) {
        console.error(error);
        console.error('Failed to init new user for business');
      }
    }

    const analytics = await initializeServerAnalytics();
    analytics?.identify(user.id, {
      email: user.email ?? undefined,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      phone: user.phone ?? undefined,
      username: user.username ?? undefined,
    });
    analytics?.track({
      name: 'user_register_completed',
      properties: {
        spm: 'user_service.init_user.user_created',
      },
      userId: user.id,
    });
  }

  createUser = async (id: string, params: UserJSON) => {
    // Check if user already exists
    const res = await UserModel.findById(this.db, id);

    // If user already exists, skip creating a new user
    if (res)
      return {
        message: 'user not created due to user already existing in the database',
        success: false,
      };

    const email = params.email_addresses.find((e) => e.id === params.primary_email_address_id);

    const phone = params.phone_numbers.find((e, index) => {
      if (!!params.primary_phone_number_id) return e.id === params.primary_phone_number_id;

      return index === 0;
    });

    // 2. create user in database
    await UserModel.createUser(this.db, {
      avatar: params.image_url,
      clerkCreatedAt: new Date(params.created_at),
      email: email?.email_address,
      firstName: params.first_name,
      id,
      lastName: params.last_name,
      phone: phone?.phone_number,
      username: params.username,
    });

    await this.initUser({
      email: email?.email_address,
      firstName: params.first_name,
      id,
      lastName: params.last_name,
      phone: phone?.phone_number,
      username: params.username,
    });

    return { message: 'user created', success: true };
  };

  deleteUser = async (id: string) => {
    await UserModel.deleteUser(this.db, id);
  };

  updateUser = async (id: string, params: UserJSON) => {
    const userModel = new UserModel(this.db, id);

    // Check if user already exists
    const res = await UserModel.findById(this.db, id);

    // If user not exists, skip update the user
    if (!res)
      return {
        message: "user not updated due to the user don't existing in the database",
        success: false,
      };

    pino.info('updating user due to clerk webhook');

    const email = params.email_addresses.find((e) => e.id === params.primary_email_address_id);
    const phone = params.phone_numbers.find((e, index) => {
      if (params.primary_phone_number_id) return e.id === params.primary_phone_number_id;
      return index === 0;
    });

    await userModel.updateUser({
      avatar: params.image_url,
      email: email?.email_address,
      firstName: params.first_name,
      id,
      lastName: params.last_name,
      phone: phone?.phone_number,
      username: params.username,
    });

    return { message: 'user updated', success: true };
  };

  getUserApiKeys = async (id: string) => {
    return UserModel.getUserApiKeys(this.db, id, KeyVaultsGateKeeper.getUserKeyVaults);
  };

  getUserAvatar = async (id: string, image: string) => {
    const s3 = new FileS3();
    const s3FileUrl = `user/avatar/${id}/${image}`;

    try {
      const file = await s3.getFileByteArray(s3FileUrl);
      if (!file) {
        return null;
      }
      return Buffer.from(file);
    } catch (error) {
      pino.error({ error }, 'Failed to get user avatar');
    }
  };
}
