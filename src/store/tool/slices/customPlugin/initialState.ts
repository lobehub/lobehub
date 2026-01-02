import { type LobeToolCustomPlugin } from '@/types/tool/plugin';

export interface CustomPluginState {
  newCustomPlugin: Partial<LobeToolCustomPlugin>;
}
export const defaultCustomPlugin: Partial<LobeToolCustomPlugin> = {
  customParams: {
    apiMode: 'simple',
    enableSettings: false,
    manifestMode: 'url',
  },
  type: 'customPlugin',
};

export const initialCustomPluginState: CustomPluginState = {
  newCustomPlugin: defaultCustomPlugin,
};
