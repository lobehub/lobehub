import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { CustomWorld } from '../../support/world';

// ============================================
// Then Steps (Assertions)
// ============================================

Then('I should see the search bar', async function (this: CustomWorld) {
  // Wait for network to be idle to ensure Suspense components are loaded
  await this.page.waitForLoadState('networkidle', { timeout: 120_000 });

  // The SearchBar component from @lobehub/ui may not pass through data-testid
  // Try to find the input element within the search component
  const searchBar = this.page.locator('input[type="text"]').first();
  await expect(searchBar).toBeVisible({ timeout: 120_000 });
});

Then('I should see assistant cards', async function (this: CustomWorld) {
  // Wait for content to load
  await this.page.waitForLoadState('networkidle', { timeout: 120_000 });

  // After migrating to SPA (react-router), links use relative paths like /assistant/:id
  // Look for assistant items by data-testid instead of href
  const assistantItems = this.page.locator('[data-testid="assistant-item"]');

  // Wait for at least one item to be visible
  await expect(assistantItems.first()).toBeVisible({ timeout: 120_000 });

  // Check we have multiple items
  const count = await assistantItems.count();
  expect(count).toBeGreaterThan(0);
});
