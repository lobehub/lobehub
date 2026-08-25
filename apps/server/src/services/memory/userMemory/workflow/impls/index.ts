import type { MemoryWorkflowMode, MemoryWorkflowTriggerService } from '../types';
import { BullMQWorkflowTrigger } from './bullmq';
import { LocalWorkflowTrigger } from './local';
import { QStashWorkflowTrigger } from './qstash';

let _mode: MemoryWorkflowMode | null = null;
let _impl: MemoryWorkflowTriggerService | null = null;

/**
 * Determines the workflow mode from environment variables.
 *
 * Priority:
 * 1. MEMORY_WORKFLOW_MODE=local-queue → BullMQ
 * 2. MEMORY_WORKFLOW_MODE=local → in-process
 * 3. AGENT_RUNTIME_MODE=queue → QStash (existing behavior)
 * 4. Default → QStash if QSTASH_TOKEN is set, otherwise local
 */
export const getMemoryWorkflowMode = (): MemoryWorkflowMode => {
  const explicit = process.env.MEMORY_WORKFLOW_MODE;
  if (explicit === 'local-queue') return 'bullmq';
  if (explicit === 'local') return 'local';
  if (process.env.AGENT_RUNTIME_MODE === 'queue') return 'qstash';
  if (process.env.QSTASH_TOKEN) return 'qstash';
  return 'local';
};

/**
 * Returns the singleton workflow trigger implementation based on the current mode.
 *
 * The implementation is cached — changing env vars at runtime requires a restart.
 */
export const getMemoryWorkflowTrigger = (): MemoryWorkflowTriggerService => {
  const mode = getMemoryWorkflowMode();

  if (_impl && _mode === mode) return _impl;

  _mode = mode;

  switch (mode) {
    case 'bullmq': {
      _impl = new BullMQWorkflowTrigger();
      break;
    }
    case 'qstash': {
      _impl = new QStashWorkflowTrigger();
      break;
    }
    case 'local':
    default: {
      _impl = new LocalWorkflowTrigger();
      break;
    }
  }

  return _impl!;
};

/**
 * Resets the cached implementation. Used in tests to switch modes.
 */
export const resetMemoryWorkflowTrigger = () => {
  _mode = null;
  _impl = null;
};
