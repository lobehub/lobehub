import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { UserSettingsRestService } from '../services/user-settings.service';
import type {
  UpdateUserProfileRequest,
  UpdateUserSettingsRequest,
} from '../types/user-settings.type';

/** `/users/me/settings` and `/users/me/profile` — the caller's own account. */
export class UserSettingsController extends BaseController {
  private async service(c: Context): Promise<UserSettingsRestService> {
    return new UserSettingsRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** GET /api/v1/users/me/settings */
  async getSettings(c: Context): Promise<Response> {
    try {
      const service = await this.service(c);
      return this.success(c, await service.getSettings(), 'Settings retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/users/me/settings */
  async updateSettings(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<UpdateUserSettingsRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.updateSettings(body), 'Settings updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/users/me/profile */
  async updateProfile(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<UpdateUserProfileRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.updateProfile(body), 'Profile updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
