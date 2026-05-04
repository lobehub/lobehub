/**
 * Producer-side helpers for converting external agent CLI output into the
 * unified `AgentStreamEvent` wire shape. Imported by:
 *   - Electron main (`HeterogeneousAgentCtr`) — desktop CC / Codex flow
 *   - The future `lh hetero exec` CLI — sandbox + terminal flow (LOBE-8516)
 *
 * Consumers (renderer executor, server `heteroIngest` handler) never need to
 * touch adapters — every event reaching them is already an `AgentStreamEvent`.
 */
export { AgentStreamPipeline, type AgentStreamPipelineOptions } from './agentStreamPipeline';
export { JsonlStreamProcessor } from './jsonlProcessor';
export { toStreamEvent } from './streamEvent';
