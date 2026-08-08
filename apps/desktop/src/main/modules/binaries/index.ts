/**
 * Binaries module
 *
 * Built-in binary specs for the desktop's BinaryManager. Other modules can
 * register additional custom specs via the manager directly.
 */

export { browserAutomationBinaries } from './agentBrowserBinaries';
export { cliAgentBinaries, detectHeterogeneousCliCommand } from './cliAgentBinaries';
export { astSearchBinaries, contentSearchBinaries } from './contentSearchBinaries';
export { fileSearchBinaries } from './fileSearchBinaries';
export { runtimeEnvironmentBinaries } from './runtimeEnvironmentBinaries';
export type { BinaryCategory, BinarySpec, BinaryStatus } from '@/core/infrastructure/BinaryManager';
export { defineCommandBinary } from '@/core/infrastructure/BinaryManager';
