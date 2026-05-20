import { describe, expect, it } from 'vitest';

import { shouldRenderTaskAgentPanelToggle } from './taskAgentPanelToggle';

describe('AgentTasksPage', () => {
  describe('shouldRenderTaskAgentPanelToggle', () => {
    it('should render the task agent panel toggle on desktop layouts', () => {
      expect(shouldRenderTaskAgentPanelToggle(false)).toBe(true);
    });

    it('should hide the task agent panel toggle on mobile layouts', () => {
      expect(shouldRenderTaskAgentPanelToggle(true)).toBe(false);
    });
  });
});
