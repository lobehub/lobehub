import { type BuiltinToolState, initialBuiltinToolState } from './slices/builtin/initialState';
import {
  type CustomPluginState,
  initialCustomPluginState,
} from './slices/customPlugin/initialState';
import { type KlavisStoreState, initialKlavisStoreState } from './slices/klavisStore/initialState';
import {
  type MarketConnectStoreState,
  initialMarketConnectStoreState,
} from './slices/marketConnectStore/initialState';
import { type MCPStoreState, initialMCPStoreState } from './slices/mcpStore/initialState';
import { type PluginStoreState, initialPluginStoreState } from './slices/oldStore/initialState';
import { type PluginState, initialPluginState } from './slices/plugin/initialState';

export type ToolStoreState = PluginState &
  CustomPluginState &
  PluginStoreState &
  BuiltinToolState &
  MCPStoreState &
  KlavisStoreState &
  MarketConnectStoreState;

export const initialState: ToolStoreState = {
  ...initialPluginState,
  ...initialCustomPluginState,
  ...initialPluginStoreState,
  ...initialBuiltinToolState,
  ...initialMCPStoreState,
  ...initialKlavisStoreState,
  ...initialMarketConnectStoreState,
};
