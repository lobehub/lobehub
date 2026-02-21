import { type ChatToolPayload } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { type PluginRequestPayload } from '@lobehub/chat-plugin-sdk';
import { type GatewaySuccessResponse } from '@lobehub/chat-plugins-gateway';
import debug from 'debug';

import { getAppConfig } from '@/envs/app';
import { parserPluginSettings } from '@/server/services/pluginGateway/settings';
import { type ToolExecutionContext } from '@/server/services/toolExecution/types';

const log = debug('lobe-server:plugin-gateway-service');

export class PluginGatewayService {
  params: { PLUGINS_INDEX_URL: string; PLUGIN_SETTINGS: string | undefined };

  constructor() {
    const { PLUGINS_INDEX_URL, PLUGIN_SETTINGS } = getAppConfig();

    this.params = { PLUGINS_INDEX_URL, PLUGIN_SETTINGS };
  }

  async execute(payload: ChatToolPayload, context: ToolExecutionContext) {
    const { identifier, apiName, arguments: argsStr } = payload;
    const args = safeParseJSON(argsStr) || {};

    log('Executing plugin: %s:%s with args: %O', identifier, apiName, args, context);

    try {
      // Construct plugin request
      const requestBody: PluginRequestPayload = {
        apiName,
        arguments: JSON.stringify(args),
        identifier,
        manifest: context.toolManifestMap[identifier] as any,
      };
      const { Gateway } = await import('@lobehub/chat-plugins-gateway');
      const gateway = new Gateway({
        defaultPluginSettings: parserPluginSettings(this.params.PLUGIN_SETTINGS),
        pluginsIndexUrl: this.params.PLUGINS_INDEX_URL,
      });

      const response = await gateway.execute(requestBody);

      log('Plugin execution result: %O', response);

      return {
        content: (response as GatewaySuccessResponse).data,
        success: true,
      };
    } catch (error) {
      console.error('Error executing plugin %s:%s: %O', identifier, apiName, error);
      return {
        content: (error as Error).message,
        error: {
          message: (error as Error).message,
        },
        success: false,
      };
    }
  }
}
