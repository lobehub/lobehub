import type { IToolDetector } from '@/core/infrastructure/ToolDetectorManager';
import { createCommandDetector } from '@/core/infrastructure/ToolDetectorManager';

/**
 * agent-browser - Headless browser automation CLI for AI agents
 * https://github.com/vercel-labs/agent-browser
 */
export const agentBrowserDetector: IToolDetector = createCommandDetector('agent-browser', {
  description: 'Vercel agent-browser - headless browser automation for AI agents',
  priority: 1,
});

export const browserAutomationDetectors: IToolDetector[] = [agentBrowserDetector];
