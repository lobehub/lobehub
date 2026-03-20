import debug from 'debug';

import { appEnv } from '@/envs/app';

import { AgentStateManager } from './AgentStateManager';
import { inMemoryAgentStateManager } from './InMemoryAgentStateManager';
import { inMemoryStreamEventManager } from './InMemoryStreamEventManager';
import { getAgentRuntimeRedisClient } from './redis';
import { StreamEventManager } from './StreamEventManager';
import { type IAgentStateManager, type IStreamEventManager } from './types';

const log = debug('lobe-server:agent-runtime:factory');

/**
 * Check if Redis is available for Agent Runtime
 */
export const isRedisAvailable = (): boolean => {
  return getAgentRuntimeRedisClient() !== null;
};

/**
 * Check if queue-based agent runtime is enabled
 * When disabled (default), use InMemory implementations for local/simple deployments
 */
const isQueueModeEnabled = (): boolean => {
  return appEnv.enableQueueAgentRuntime === true;
};

/**
 * Create AgentStateManager based on configuration
 */
export const createAgentStateManager = (): IAgentStateManager => {
  // When queue mode is disabled, always use InMemory for simplicity
  if (!isQueueModeEnabled()) {
    log('Queue mode disabled, using InMemoryAgentStateManager');
    return inMemoryAgentStateManager;
  }

  // Queue mode enabled, Redis is required
  if (!isRedisAvailable()) {
    throw new Error(
      'Redis is required when AGENT_RUNTIME_MODE=queue. Please configure `REDIS_URL`.',
    );
  }

  return new AgentStateManager();
};

/**
 * Create StreamEventManager based on configuration
 *
 * - If Redis is available: RedisStreamEventManager
 * - If Redis is unavailable and enableQueueAgentRuntime=false (default): InMemoryStreamEventManager
 * - If Redis is unavailable and enableQueueAgentRuntime=true: throw
 */
export const createStreamEventManager = (): IStreamEventManager => {
  // Prefer Redis whenever it is available so the runtime worker and SSE route
  // can communicate through the same stream bus even in local mode.
  if (isRedisAvailable()) {
    log('Redis available, using StreamEventManager');
    return new StreamEventManager();
  }

  if (!isQueueModeEnabled()) {
    log('Redis unavailable and queue mode disabled, using InMemoryStreamEventManager');
    return inMemoryStreamEventManager;
  }

  throw new Error('Redis is required when AGENT_RUNTIME_MODE=queue. Please configure `REDIS_URL`.');
};
