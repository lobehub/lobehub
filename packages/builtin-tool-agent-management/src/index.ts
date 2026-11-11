export * from './callAgentManifest';
export * from './manifest';
export * from './resolveManifest';
export * from './systemRole';
export * from './types';
// Pure (store-free) helpers so the server tool runtime formats getAgentDetail
// exactly like the client runtime without importing its client-only index.
export {
  buildAgentDetailContent,
  describeHeterogeneousAgent,
} from '@lobechat/agent-manager-runtime/agentDetail';
