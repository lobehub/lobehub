// The wire contract (stdin payload builder + content-block types) lives in
// `../../protocol` so dispatch-only consumers (server sandbox runner) can
// import it without bundling the fs-heavy spawn machinery. Re-exported here
// so executor-side callers keep a single `./spawn` entry.
export {
  type AgentContentBlock,
  type AgentImageBlock,
  type AgentImageSource,
  type AgentPromptInput,
  type AgentTextBlock,
  buildHeteroExecStdinPayload,
  type HeteroExecImageRef,
} from '../../protocol';
export {
  type AgentInputPlan,
  buildAgentInput,
  type BuildAgentInputOptions,
} from './buildAgentInput';
export {
  materializeImageToPath,
  type NormalizedImage,
  normalizeImage,
  type NormalizeImageOptions,
} from './normalizeImage';
