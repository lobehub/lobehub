import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { ImRestService } from '../services/im.service';
import type {
  ImReadRequest,
  ImSendRequest,
  ImSyncQuery,
  ImTopicParam,
  PushTokenParam,
  PushTokenRegisterRequest,
  PushTokenUnregisterQuery,
} from '../types/im.type';

/** IM channel controller — send, sync (long-poll), read receipts, push tokens. */
export class ImController extends BaseController {
  private async service(c: Context): Promise<ImRestService> {
    return new ImRestService(await this.getDatabase(), this.getUserId(c), this.getWorkspaceId(c));
  }

  /** POST /api/v1/im/messages */
  async send(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<ImSendRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.send(body), 'Message received');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/im/topics/:topicId/sync */
  async sync(c: Context): Promise<Response> {
    try {
      const { topicId } = this.getParams<ImTopicParam>(c);
      const query = this.getQuery<ImSyncQuery>(c);
      const service = await this.service(c);
      return this.success(c, await service.sync(topicId, query));
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/im/topics/:topicId/read */
  async markRead(c: Context): Promise<Response> {
    try {
      const { topicId } = this.getParams<ImTopicParam>(c);
      const body = await this.getBody<ImReadRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.markRead(topicId, body), 'Marked as read');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PUT /api/v1/push-tokens/:deviceId */
  async registerPushToken(c: Context): Promise<Response> {
    try {
      const { deviceId } = this.getParams<PushTokenParam>(c);
      const body = await this.getBody<PushTokenRegisterRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.registerPushToken(deviceId, body), 'Device registered');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/push-tokens/:deviceId */
  async unregisterPushToken(c: Context): Promise<Response> {
    try {
      const { deviceId } = this.getParams<PushTokenParam>(c);
      const { expoToken } = this.getQuery<PushTokenUnregisterQuery>(c);
      const service = await this.service(c);
      await service.unregisterPushToken(deviceId, expoToken);
      return this.success(c, undefined, 'Device unregistered');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
