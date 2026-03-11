import { type LobeTool } from '@lobechat/types';
import { type PluginSchema } from '@lobehub/chat-plugin-sdk';

import { type MetaData } from '@/types/meta';

const getPluginFormList = (list: LobeTool[], id: string) => list?.find((p) => p.identifier === id);

const getPluginTitle = (meta?: MetaData) => meta?.title;
const getPluginDesc = (meta?: MetaData) => meta?.description;

const getPluginTags = (meta?: MetaData) => meta?.tags;
const getPluginAvatar = (meta?: MetaData) => meta?.avatar || '🧩';

const isCustomPlugin = (id: string, pluginList: LobeTool[]) =>
  pluginList.some((i) => i.identifier === id && i.type === 'customPlugin');

const isSettingSchemaNonEmpty = (schema?: PluginSchema) =>
  schema?.properties && Object.keys(schema.properties).length > 0;

export const pluginHelpers = {
  getPluginAvatar,
  getPluginDesc,
  getPluginFormList,
  getPluginTags,
  getPluginTitle,
  isCustomPlugin,
  isSettingSchemaNonEmpty,
};
