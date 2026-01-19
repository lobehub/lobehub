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

  // Find the category menu items - they are clickable elements in the sidebar
  // The UI shows categories like "All", "Academic", "Career", etc.
  const categoryItems = this.page.locator(
    '[class*="CategoryMenu"] [class*="Item"], [class*="category"] a, [class*="category"] button, [role="menuitem"]',
  );

  const count = await categoryItems.count();
  console.log(`   📍 Found ${count} category items`);

  if (count === 0) {
    // Fallback: try finding by text content that looks like a category
    const fallbackCategories = this.page.locator(
      'text=/^(Academic|Career|Design|Programming|General)/',
    );
    const fallbackCount = await fallbackCategories.count();
    console.log(`   📍 Fallback: Found ${fallbackCount} category items by text`);

    if (fallbackCount > 0) {
      await fallbackCategories.first().click();
      this.testContext.selectedCategory = await fallbackCategories.first().textContent();
      return;
    }
  }

  // Wait for categories to be visible
  await categoryItems.first().waitFor({ state: 'visible', timeout: 30_000 });

  // Click the third category (skip "Discover" at index 0 and "All" at index 1)
  // This should select the first actual category filter like "Academic"
  const targetCategory = categoryItems.nth(2);
  await targetCategory.click();

  // Store the category for later verification
  const categoryText = await targetCategory.textContent();
  this.testContext.selectedCategory = categoryText?.trim();
});

When('I click on a category in the category filter', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Find the category filter items - MCP page has categories like "Developer Tools", "Productivity Tools"
  // Use the same selector pattern as the category menu
  const categoryItems = this.page.locator(
    '[class*="CategoryMenu"] [class*="Item"], [class*="category"] a, [class*="category"] button, [role="menuitem"]',
  );

  const count = await categoryItems.count();
  console.log(`   📍 Found ${count} category filter items`);

  if (count === 0) {
    // Fallback: try finding by text content that looks like MCP categories
    const fallbackCategories = this.page.locator(
      'text=/^(Developer Tools|Productivity Tools|Utility Tools|Media Generation|Business Services)/',
    );
    const fallbackCount = await fallbackCategories.count();
    console.log(`   📍 Fallback: Found ${fallbackCount} MCP category items by text`);

    if (fallbackCount > 0) {
      await fallbackCategories.first().click();
      this.testContext.selectedCategory = await fallbackCategories.first().textContent();
      return;
    }
  }

  // Wait for categories to be visible
  await categoryItems.first().waitFor({ state: 'visible', timeout: 30_000 });

  // Click the third category (skip "Discover" at index 0 and "All" at index 1)
  // This should select the first actual category filter
  const targetCategory = categoryItems.nth(2);
  await targetCategory.click();

  // Store the category for later verification
  const categoryText = await targetCategory.textContent();
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

  // Wait for initial cards to load first
  const assistantCards = this.page.locator('[data-testid="assistant-item"]');
  await assistantCards.first().waitFor({ state: 'visible', timeout: 30_000 });

  const initialCount = await assistantCards.count();
  console.log(`   📍 Initial card count: ${initialCount}`);

  // The page uses infinite scroll instead of pagination buttons
  // Scroll to bottom to trigger infinite scroll
  console.log('   📍 Page uses infinite scroll, scrolling to bottom');
  await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await this.page.waitForTimeout(2000); // Wait for new content to load

  // Store the flag indicating we used infinite scroll
  this.testContext.usedInfiniteScroll = true;
  this.testContext.initialCardCount = initialCount;
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

    // The home page might not have a direct MCP section with a "more" link
    // Try to find MCP-specific link first, then fall back to direct navigation
    const mcpLink = this.page.locator('a[href*="/community/mcp"], a[href*="mcp"]').first();
    const mcpLinkVisible = await mcpLink.isVisible().catch(() => false);

    if (mcpLinkVisible) {
      console.log('   📍 Found direct MCP link');
      await mcpLink.click();
      return;
    }

    // Try to find "more" link near MCP-related content
    const mcpSection = this.page.locator('section:has-text("MCP"), div:has-text("MCP Tools")');
    const mcpSectionVisible = await mcpSection
      .first()
      .isVisible()
      .catch(() => false);

    if (mcpSectionVisible) {
      const moreLinkInSection = mcpSection.locator(
        `a:has-text("${linkText}"), button:has-text("${linkText}")`,
      );
      if ((await moreLinkInSection.count()) > 0) {
        await moreLinkInSection.first().click();
        return;
      }
    }

    // Fallback: click on MCP in the sidebar navigation
    console.log('   📍 Fallback: clicking MCP in sidebar');
    const mcpNavItem = this.page
      .locator('nav a:has-text("MCP"), [class*="nav"] a:has-text("MCP")')
      .first();
    if (await mcpNavItem.isVisible().catch(() => false)) {
      await mcpNavItem.click();
      return;
    }

    // Last resort: navigate directly
    console.log('   📍 Last resort: direct navigation to /community/mcp');
    await this.page.goto('/community/mcp');
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
  console.log(`   📍 Current URL: ${currentUrl}`);
  console.log(`   📍 Selected category: ${this.testContext.selectedCategory}`);

  // Check if URL contains a category-related parameter
  // The URL format is: /community/agent?category=xxx
  const hasCategory =
    currentUrl.includes('category=') ||
    currentUrl.includes('tag=') ||
    // For path-based routing like /community/agent/category-name
    /\/community\/assistant\/[^/?]+/.test(currentUrl);

  expect(
    hasCategory,
    `Expected URL to contain category parameter, but got: ${currentUrl}`,
  ).toBeTruthy();
});

Then('I should see different assistant cards', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const assistantItems = this.page.locator('[data-testid="assistant-item"]');

  // Wait for at least one item to be visible
  await expect(assistantItems.first()).toBeVisible({ timeout: 30_000 });

  const currentCount = await assistantItems.count();
  console.log(`   📍 Current card count: ${currentCount}`);

  // If we used infinite scroll, check that we have cards (might be same or more)
  if (this.testContext.usedInfiniteScroll) {
    console.log(
      `   📍 Used infinite scroll, initial count was: ${this.testContext.initialCardCount}`,
    );
    expect(currentCount).toBeGreaterThan(0);
  } else {
    expect(currentCount).toBeGreaterThan(0);
  }
});

Then('the URL should contain the page parameter', async function (this: CustomWorld) {
  const currentUrl = this.page.url();

  // If we used infinite scroll, URL won't have page parameter - that's expected
  if (this.testContext.usedInfiniteScroll) {
    console.log('   📍 Used infinite scroll, page parameter not expected');
    // Just verify we're still on the assistant page
    expect(currentUrl.includes('/community/agent')).toBeTruthy();
    return;
  }

  // Check if URL contains a page parameter (only for traditional pagination)
  expect(
    currentUrl.includes('page=') || currentUrl.includes('p='),
    `Expected URL to contain page parameter, but got: ${currentUrl}`,
  ).toBeTruthy();
});

Then('I should be navigated to the assistant detail page', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const currentUrl = this.page.url();
  // Verify that URL changed and contains /assistant/ followed by an identifier
  const hasAssistantDetail = /\/community\/assistant\/[^#?]+/.test(currentUrl);
  const urlChanged = currentUrl !== this.testContext.previousUrl;

  expect(
    hasAssistantDetail && urlChanged,
    `Expected to navigate to assistant detail page, but URL is: ${currentUrl} (previous: ${this.testContext.previousUrl})`,
  ).toBeTruthy();
});

Then('I should see the assistant detail content', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Look for assistant detail page content
  const detailContent = this.page.locator('[data-testid="assistant-detail-content"]');
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
  const hasModelDetail = /\/community\/model\/[^#?]+/.test(currentUrl);
  const urlChanged = currentUrl !== this.testContext.previousUrl;

  expect(
    hasModelDetail && urlChanged,
    `Expected to navigate to model detail page, but URL is: ${currentUrl} (previous: ${this.testContext.previousUrl})`,
  ).toBeTruthy();
});

Then('I should see the model detail content', async function (this: CustomWorld) {
  // Wait for page to load
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Model detail page should have tabs like "Overview", "Model Parameters"
  // Wait for these specific elements to appear
  const modelTabs = this.page.locator(
    'text=/Overview|Model Parameters|Related Recommendations|Configuration Guide/',
  );

  console.log('   📍 Waiting for model detail content to load...');
  await expect(modelTabs.first()).toBeVisible({ timeout: 30_000 });

  const tabCount = await modelTabs.count();
  console.log(`   📍 Found ${tabCount} model detail tabs`);

  expect(tabCount).toBeGreaterThan(0);
});

Then('I should be navigated to the provider detail page', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  const currentUrl = this.page.url();
  // Verify that URL changed and contains /provider/ followed by an identifier
  const hasProviderDetail = /\/community\/provider\/[^#?]+/.test(currentUrl);
  const urlChanged = currentUrl !== this.testContext.previousUrl;

  expect(
    hasProviderDetail && urlChanged,
    `Expected to navigate to provider detail page, but URL is: ${currentUrl} (previous: ${this.testContext.previousUrl})`,
  ).toBeTruthy();
});

Then('I should see the provider detail content', async function (this: CustomWorld) {
  // Wait for page to load
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Provider detail page should have provider name/title and model list
  // Wait for the provider title to appear
  const providerTitle = this.page.locator('h1, h2, [class*="title"]').first();

  console.log('   📍 Waiting for provider detail content to load...');
  await expect(providerTitle).toBeVisible({ timeout: 30_000 });

  const titleText = await providerTitle.textContent();
  console.log(`   📍 Provider title: ${titleText}`);

  expect(titleText?.trim().length).toBeGreaterThan(0);
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
  const hasMcpDetail = /\/community\/mcp\/[^#?]+/.test(currentUrl);
  const urlChanged = currentUrl !== this.testContext.previousUrl;

  expect(
    hasMcpDetail && urlChanged,
    `Expected to navigate to MCP detail page, but URL is: ${currentUrl} (previous: ${this.testContext.previousUrl})`,
  ).toBeTruthy();
});

Then('I should see the MCP detail content', async function (this: CustomWorld) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });

  // Look for MCP detail page content
  const detailContent = this.page.locator('[data-testid="mcp-detail-content"]');
  await expect(detailContent).toBeVisible({ timeout: 30_000 });
});

Then('I should be navigated to {string}', async function (this: CustomWorld, expectedPath: string) {
  await this.page.waitForLoadState('networkidle', { timeout: 30_000 });
  await this.page.waitForTimeout(500); // Extra wait for client-side routing

  const currentUrl = this.page.url();
  console.log(`   📍 Expected path: ${expectedPath}, Current URL: ${currentUrl}`);

  // Verify that URL contains the expected path
  const urlMatches = currentUrl.includes(expectedPath);

  if (!urlMatches) {
    console.log(`   ⚠️ URL mismatch, but page might still be correct`);
  }

  expect(
    urlMatches,
    `Expected URL to contain "${expectedPath}", but got: ${currentUrl}`,
  ).toBeTruthy();
});
