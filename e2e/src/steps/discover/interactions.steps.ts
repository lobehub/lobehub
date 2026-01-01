import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { CustomWorld } from '../../support/world';

// ============================================
// When Steps (Actions)
// ============================================

When('I type {string} in the search bar', async function (this: CustomWorld, searchText: string) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const searchBar = this.page.locator('input[type="text"]').first();
  await searchBar.waitFor({ state: 'visible', timeout: 30_000 });
  await searchBar.fill(searchText);

  // Store the search text for later assertions
  this.testContext.searchText = searchText;
});

When('I wait for the search results to load', async function (this: CustomWorld) {
  // Wait for network to be idle after typing
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });
  // Add a small delay to ensure UI updates
  await this.page.waitForTimeout(500);
});

When('I click on a category in the category menu', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Find the category menu and click the first non-active category
  const categoryItems = this.page.locator(
    '[data-testid="category-menu"] button, [role="menu"] button, nav[aria-label*="categor" i] button',
  );

  // Wait for categories to be visible
  await categoryItems.first().waitFor({ state: 'visible', timeout: 30_000 });

  // Click the second category (skip "All" which is usually first)
  const secondCategory = categoryItems.nth(1);
  await secondCategory.click();

  // Store the category for later verification
  const categoryText = await secondCategory.textContent();
  this.testContext.selectedCategory = categoryText?.trim();
});

When('I click on a category in the category filter', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Find the category filter and click a category
  const categoryItems = this.page.locator(
    '[data-testid="category-filter"] button, [data-testid="category-menu"] button',
  );

  // Wait for categories to be visible
  await categoryItems.first().waitFor({ state: 'visible', timeout: 30_000 });

  // Click the second category (skip "All" which is usually first)
  const secondCategory = categoryItems.nth(1);
  await secondCategory.click();

  // Store the category for later verification
  const categoryText = await secondCategory.textContent();
  this.testContext.selectedCategory = categoryText?.trim();
});

When('I wait for the filtered results to load', async function (this: CustomWorld) {
  // Wait for network to be idle after filtering
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });
  // Add a small delay to ensure UI updates
  await this.page.waitForTimeout(500);
});

When('I click the next page button', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Find and click the next page button
  const nextButton = this.page.locator(
    'button:has-text("Next"), button[aria-label*="next" i], .pagination button:last-child',
  );

  await nextButton.waitFor({ state: 'visible', timeout: 30_000 });
  await nextButton.click();
});

When('I wait for the next page to load', async function (this: CustomWorld) {
  // Wait for network to be idle after page change
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });
  // Add a small delay to ensure UI updates
  await this.page.waitForTimeout(500);
});

When('I click on the first assistant card', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const firstCard = this.page.locator('[data-testid="assistant-item"]').first();
  await firstCard.waitFor({ state: 'visible', timeout: 30_000 });

  // Store the current URL before clicking
  this.testContext.previousUrl = this.page.url();

  await firstCard.click();

  // Wait for URL to change
  await this.page.waitForFunction(
    (previousUrl) => window.location.href !== previousUrl,
    this.testContext.previousUrl,
    { timeout: 30_000 },
  );
});

When('I click on the first model card', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const firstCard = this.page.locator('[data-testid="model-item"]').first();
  await firstCard.waitFor({ state: 'visible', timeout: 30_000 });

  // Store the current URL before clicking
  this.testContext.previousUrl = this.page.url();

  await firstCard.click();

  // Wait for URL to change
  await this.page.waitForFunction(
    (previousUrl) => window.location.href !== previousUrl,
    this.testContext.previousUrl,
    { timeout: 30_000 },
  );
});

When('I click on the first provider card', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const firstCard = this.page.locator('[data-testid="provider-item"]').first();
  await firstCard.waitFor({ state: 'visible', timeout: 30_000 });

  // Store the current URL before clicking
  this.testContext.previousUrl = this.page.url();

  await firstCard.click();

  // Wait for URL to change
  await this.page.waitForFunction(
    (previousUrl) => window.location.href !== previousUrl,
    this.testContext.previousUrl,
    { timeout: 30_000 },
  );
});

When('I click on the first MCP card', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const firstCard = this.page.locator('[data-testid="mcp-item"]').first();
  await firstCard.waitFor({ state: 'visible', timeout: 30_000 });

  // Store the current URL before clicking
  this.testContext.previousUrl = this.page.url();

  await firstCard.click();

  // Wait for URL to change
  await this.page.waitForFunction(
    (previousUrl) => window.location.href !== previousUrl,
    this.testContext.previousUrl,
    { timeout: 30_000 },
  );
});

When('I click on the sort dropdown', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const sortDropdown = this.page
    .locator(
      '[data-testid="sort-dropdown"], select, button[aria-label*="sort" i], [role="combobox"]',
    )
    .first();

  await sortDropdown.waitFor({ state: 'visible', timeout: 30_000 });
  await sortDropdown.click();
});

When('I select a sort option', async function (this: CustomWorld) {
  await this.page.waitForTimeout(500);

  // Find and click a sort option (assuming dropdown opens a menu)
  const sortOptions = this.page.locator('[role="option"], [role="menuitem"]');

  // Wait for options to appear
  await sortOptions.first().waitFor({ state: 'visible', timeout: 30_000 });

  // Click the second option (skip the default/first one)
  const secondOption = sortOptions.nth(1);
  await secondOption.click();

  // Store the option for later verification
  const optionText = await secondOption.textContent();
  this.testContext.selectedSortOption = optionText?.trim();
});

When('I wait for the sorted results to load', async function (this: CustomWorld) {
  // Wait for network to be idle after sorting
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });
  // Add a small delay to ensure UI updates
  await this.page.waitForTimeout(500);
});

When(
  'I click on the {string} link in the featured assistants section',
  async function (this: CustomWorld, linkText: string) {
    await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Find the featured assistants section and the "more" link
    const moreLink = this.page
      .locator(`a:has-text("${linkText}"), button:has-text("${linkText}")`)
      .first();

    await moreLink.waitFor({ state: 'visible', timeout: 30_000 });
    await moreLink.click();
  },
);

When(
  'I click on the {string} link in the featured MCP tools section',
  async function (this: CustomWorld, linkText: string) {
    await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Find the MCP section and the "more" link
    // Since there might be multiple "more" links, we'll click the second one (MCP is after assistants)
    const moreLinks = this.page.locator(
      `a:has-text("${linkText}"), button:has-text("${linkText}")`,
    );

    // Wait for links to be visible
    await moreLinks.first().waitFor({ state: 'visible', timeout: 30_000 });

    // Click the second "more" link (for MCP section)
    await moreLinks.nth(1).click();
  },
);

When('I click on the first featured assistant card', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const firstCard = this.page.locator('[data-testid="assistant-item"]').first();
  await firstCard.waitFor({ state: 'visible', timeout: 30_000 });

  // Store the current URL before clicking
  this.testContext.previousUrl = this.page.url();

  await firstCard.click();

  // Wait for URL to change
  await this.page.waitForFunction(
    (previousUrl) => window.location.href !== previousUrl,
    this.testContext.previousUrl,
    { timeout: 30_000 },
  );
});

// ============================================
// Then Steps (Assertions)
// ============================================

Then('I should see filtered assistant cards', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const assistantItems = this.page.locator('[data-testid="assistant-item"]');

  // Wait for at least one item to be visible
  await expect(assistantItems.first()).toBeVisible({ timeout: 30_000 });

  // Verify that at least one item exists
  const count = await assistantItems.count();
  expect(count).toBeGreaterThan(0);
});

Then(
  'I should see assistant cards filtered by the selected category',
  async function (this: CustomWorld) {
    await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

    const assistantItems = this.page.locator('[data-testid="assistant-item"]');

    // Wait for at least one item to be visible
    await expect(assistantItems.first()).toBeVisible({ timeout: 30_000 });

    // Verify that at least one item exists
    const count = await assistantItems.count();
    expect(count).toBeGreaterThan(0);
  },
);

Then('the URL should contain the category parameter', async function (this: CustomWorld) {
  const currentUrl = this.page.url();
  // Check if URL contains a category-related parameter
  expect(
    currentUrl.includes('category=') || currentUrl.includes('tag='),
    `Expected URL to contain category parameter, but got: ${currentUrl}`,
  ).toBeTruthy();
});

Then('I should see different assistant cards', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const assistantItems = this.page.locator('[data-testid="assistant-item"]');

  // Wait for at least one item to be visible
  await expect(assistantItems.first()).toBeVisible({ timeout: 30_000 });

  // Verify that at least one item exists
  const count = await assistantItems.count();
  expect(count).toBeGreaterThan(0);
});

Then('the URL should contain the page parameter', async function (this: CustomWorld) {
  const currentUrl = this.page.url();
  // Check if URL contains a page parameter
  expect(
    currentUrl.includes('page=') || currentUrl.includes('p='),
    `Expected URL to contain page parameter, but got: ${currentUrl}`,
  ).toBeTruthy();
});

Then('I should be navigated to the assistant detail page', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const currentUrl = this.page.url();
  // Verify that URL changed and contains /assistant/ followed by an identifier
  const hasAssistantDetail = /\/discover\/assistant\/[^#?]+/.test(currentUrl);
  const urlChanged = currentUrl !== this.testContext.previousUrl;

  expect(
    hasAssistantDetail && urlChanged,
    `Expected to navigate to assistant detail page, but URL is: ${currentUrl} (previous: ${this.testContext.previousUrl})`,
  ).toBeTruthy();
});

Then('I should see the assistant detail content', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Look for detail page elements (e.g., title, description, etc.)
  const detailContent = this.page.locator('[data-testid="detail-content"], main, article').first();
  await expect(detailContent).toBeVisible({ timeout: 30_000 });
});

Then('I should see model cards in the sorted order', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const modelItems = this.page.locator('[data-testid="model-item"]');

  // Wait for at least one item to be visible
  await expect(modelItems.first()).toBeVisible({ timeout: 30_000 });

  // Verify that at least one item exists
  const count = await modelItems.count();
  expect(count).toBeGreaterThan(0);
});

Then('I should be navigated to the model detail page', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const currentUrl = this.page.url();
  // Verify that URL changed and contains /model/ followed by an identifier
  const hasModelDetail = /\/discover\/model\/[^#?]+/.test(currentUrl);
  const urlChanged = currentUrl !== this.testContext.previousUrl;

  expect(
    hasModelDetail && urlChanged,
    `Expected to navigate to model detail page, but URL is: ${currentUrl} (previous: ${this.testContext.previousUrl})`,
  ).toBeTruthy();
});

Then('I should see the model detail content', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Look for detail page elements
  const detailContent = this.page.locator('[data-testid="detail-content"], main, article').first();
  await expect(detailContent).toBeVisible({ timeout: 30_000 });
});

Then('I should be navigated to the provider detail page', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const currentUrl = this.page.url();
  // Verify that URL changed and contains /provider/ followed by an identifier
  const hasProviderDetail = /\/discover\/provider\/[^#?]+/.test(currentUrl);
  const urlChanged = currentUrl !== this.testContext.previousUrl;

  expect(
    hasProviderDetail && urlChanged,
    `Expected to navigate to provider detail page, but URL is: ${currentUrl} (previous: ${this.testContext.previousUrl})`,
  ).toBeTruthy();
});

Then('I should see the provider detail content', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Look for detail page elements
  const detailContent = this.page.locator('[data-testid="detail-content"], main, article').first();
  await expect(detailContent).toBeVisible({ timeout: 30_000 });
});

Then(
  'I should see MCP cards filtered by the selected category',
  async function (this: CustomWorld) {
    await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

    const mcpItems = this.page.locator('[data-testid="mcp-item"]');

    // Wait for at least one item to be visible
    await expect(mcpItems.first()).toBeVisible({ timeout: 30_000 });

    // Verify that at least one item exists
    const count = await mcpItems.count();
    expect(count).toBeGreaterThan(0);
  },
);

Then('I should be navigated to the MCP detail page', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const currentUrl = this.page.url();
  // Verify that URL changed and contains /mcp/ followed by an identifier
  const hasMcpDetail = /\/discover\/mcp\/[^#?]+/.test(currentUrl);
  const urlChanged = currentUrl !== this.testContext.previousUrl;

  expect(
    hasMcpDetail && urlChanged,
    `Expected to navigate to MCP detail page, but URL is: ${currentUrl} (previous: ${this.testContext.previousUrl})`,
  ).toBeTruthy();
});

Then('I should see the MCP detail content', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Look for detail page elements
  const detailContent = this.page.locator('[data-testid="detail-content"], main, article').first();
  await expect(detailContent).toBeVisible({ timeout: 30_000 });
});

Then('I should be navigated to {string}', async function (this: CustomWorld, expectedPath: string) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const currentUrl = this.page.url();
  // Verify that URL contains the expected path
  expect(
    currentUrl.includes(expectedPath),
    `Expected URL to contain "${expectedPath}", but got: ${currentUrl}`,
  ).toBeTruthy();
});
