import debug from 'debug';

import { AgentStateManager } from './AgentStateManager';
import { inMemoryAgentStateManager } from './InMemoryAgentStateManager';
import {
  inMemoryStreamEventManager,
} from './InMemoryStreamEventManager';
import { StreamEventManager } from './StreamEventManager';
import { getAgentRuntimeRedisClient } from './redis';
import type { IAgentStateManager, IStreamEventManager } from './types';

const log = debug('lobe-server:agent-runtime:factory');

/**
 * Check if Redis is available for Agent Runtime
 */
export const isRedisAvailable = (): boolean => {
  return getAgentRuntimeRedisClient() !== null;
};

/**
 * Create AgentStateManager based on Redis availability
 *
 * - Redis available: RedisAgentStateManager
 * - Redis not available: InMemoryAgentStateManager (for local development)
 */
export const createAgentStateManager = (): IAgentStateManager => {
  if (isRedisAvailable()) {
    log('Creating Redis-based AgentStateManager');
    return new AgentStateManager();
  }

  log('Redis not available, using InMemoryAgentStateManager for local development');
  return inMemoryAgentStateManager;
};

/**
 * Create StreamEventManager based on Redis availability
 *
 * - Redis available: RedisStreamEventManager
 * - Redis not available: InMemoryStreamEventManager (for local development)
 */
export const createStreamEventManager = (): IStreamEventManager => {
  if (isRedisAvailable()) {
    log('Creating Redis-based StreamEventManager');
    return new StreamEventManager();
  }

  log('Redis not available, using InMemoryStreamEventManager for local development');
  return inMemoryStreamEventManager;
};
