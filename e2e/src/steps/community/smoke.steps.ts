import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { CustomWorld } from '../../support/world';

// ============================================
// Then Steps (Assertions)
// ============================================

// Assistant List Page Steps
Then('I should see the search bar', async function (this: CustomWorld) {
  // SearchBar component has data-testid="search-bar"
  const searchBar = this.page.locator('[data-testid="search-bar"]').first();
  await expect(searchBar).toBeVisible({ timeout: 30_000 });
});

Then(
  'I should see the assistant category {string}',
  async function (this: CustomWorld, category: string) {
    const groupLink = this.page.locator(
      `section a[href="/marketplace/agent?category=${category}"]`,
    );
    await expect(groupLink).toBeVisible({ timeout: 30_000 });
  },
);

Then('I should see assistant cards', async function (this: CustomWorld) {
  // Look for assistant items by data-testid
  const assistantItems = this.page.locator('[data-testid="assistant-item"]');

  // Wait for at least one item to be visible
  await expect(assistantItems.first()).toBeVisible({ timeout: 30_000 });

  // Check we have multiple items
  const count = await assistantItems.count();
  expect(count).toBeGreaterThan(0);
});

// Model List Page Steps
Then('I should see model cards', async function (this: CustomWorld) {
  // Model items have data-testid="model-item"
  const modelItems = this.page.locator('[data-testid="model-item"]');

  // Wait for at least one item to be visible
  await expect(modelItems.first()).toBeVisible({ timeout: 30_000 });

  // Check we have multiple items
  const count = await modelItems.count();
  expect(count).toBeGreaterThan(0);
});

Then('I should see the sort dropdown', async function (this: CustomWorld) {
  // SortButton has data-testid="sort-dropdown"
  const sortDropdown = this.page.locator('[data-testid="sort-dropdown"]').first();
  await expect(sortDropdown).toBeVisible({ timeout: 30_000 });
});

// Provider List Page Steps
Then('I should see provider cards', async function (this: CustomWorld) {
  // Look for provider items by data-testid
  const providerItems = this.page.locator('[data-testid="provider-item"]');

  // Wait for at least one item to be visible
  await expect(providerItems.first()).toBeVisible({ timeout: 30_000 });

  // Check we have multiple items
  const count = await providerItems.count();
  expect(count).toBeGreaterThan(0);
});

// MCP List Page Steps
Then('I should see MCP cards', async function (this: CustomWorld) {
  // Look for MCP items by data-testid
  const mcpItems = this.page.locator('[data-testid="mcp-item"]');

  // Wait for at least one item to be visible
  await expect(mcpItems.first()).toBeVisible({ timeout: 30_000 });

  // Check we have multiple items
  const count = await mcpItems.count();
  expect(count).toBeGreaterThan(0);
});

Then(
  'I should see the MCP category {string}',
  async function (this: CustomWorld, category: string) {
    await expect(
      this.page.locator(`section a[href="/marketplace/connector?category=${category}"]`),
    ).toBeVisible();
  },
);
