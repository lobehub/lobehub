import { Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { CustomWorld } from '../../support/world';

// ============================================
// Then Steps (Assertions)
// ============================================

// Home Page Steps
Then('I should see the featured assistants section', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  // Look for "Featured Agents" heading text (i18n key: home.featuredAssistants)
  // Supports: en-US "Featured Agents", zh-CN "推荐助理"
  const featuredSection = this.page
    .getByRole('heading', { name: /featured agents|推荐助理/i })
    .first();
  await expect(featuredSection).toBeVisible({ timeout: 10_000 });
});

Then('I should see the featured MCP tools section', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  // Look for "Featured Skills" heading text (i18n key: home.featuredTools)
  // Supports: en-US "Featured Skills", zh-CN "推荐技能"
  const mcpSection = this.page.getByRole('heading', { name: /featured skills|推荐技能/i }).first();
  await expect(mcpSection).toBeVisible({ timeout: 10_000 });
});

// Assistant List Page Steps
Then('I should see the search bar', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  // SearchBar component has data-testid="search-bar"
  const searchBar = this.page.locator('[data-testid="search-bar"]').first();
  await expect(searchBar).toBeVisible({ timeout: 10_000 });
});

Then('I should see the category menu', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  // CategoryMenu component has data-testid="category-menu"
  const categoryMenu = this.page.locator('[data-testid="category-menu"]').first();
  await expect(categoryMenu).toBeVisible({ timeout: 10_000 });
});

Then('I should see assistant cards', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  // Look for assistant items by data-testid
  const assistantItems = this.page.locator('[data-testid="assistant-item"]');

  // Wait for at least one item to be visible
  await expect(assistantItems.first()).toBeVisible({ timeout: 10_000 });

  // Check we have multiple items
  const count = await assistantItems.count();
  expect(count).toBeGreaterThan(0);
});

Then('I should see pagination controls', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  // Pagination component has data-testid="pagination"
  const pagination = this.page.locator('[data-testid="pagination"]').first();
  await expect(pagination).toBeVisible({ timeout: 10_000 });
});

// Model List Page Steps
Then('I should see model cards', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  // Model items have data-testid="model-item"
  const modelItems = this.page.locator('[data-testid="model-item"]');

  // Wait for at least one item to be visible
  await expect(modelItems.first()).toBeVisible({ timeout: 10_000 });

  // Check we have multiple items
  const count = await modelItems.count();
  expect(count).toBeGreaterThan(0);
});

Then('I should see the sort dropdown', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  // SortButton has data-testid="sort-dropdown"
  const sortDropdown = this.page.locator('[data-testid="sort-dropdown"]').first();
  await expect(sortDropdown).toBeVisible({ timeout: 10_000 });
});

// Provider List Page Steps
Then('I should see provider cards', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  // Look for provider items by data-testid
  const providerItems = this.page.locator('[data-testid="provider-item"]');

  // Wait for at least one item to be visible
  await expect(providerItems.first()).toBeVisible({ timeout: 10_000 });

  // Check we have multiple items
  const count = await providerItems.count();
  expect(count).toBeGreaterThan(0);
});

// MCP List Page Steps
Then('I should see MCP cards', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  // Look for MCP items by data-testid
  const mcpItems = this.page.locator('[data-testid="mcp-item"]');

  // Wait for at least one item to be visible
  await expect(mcpItems.first()).toBeVisible({ timeout: 10_000 });

  // Check we have multiple items
  const count = await mcpItems.count();
  expect(count).toBeGreaterThan(0);
});

Then('I should see the category filter', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  // CategoryMenu component has data-testid="category-menu" (shared across list pages)
  const categoryFilter = this.page.locator('[data-testid="category-menu"]').first();
  await expect(categoryFilter).toBeVisible({ timeout: 10_000 });
});
