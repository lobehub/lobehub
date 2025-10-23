# E2E Tests for LobeChat

This directory contains end-to-end (E2E) tests for LobeChat using Cucumber (BDD) and Playwright.

## Directory Structure

````
e2e/
├── src/               # Source files
│   ├── features/      # Gherkin feature files
│   │   └── discover/  # Discover page tests
│   ├── steps/         # Step definitions
│   │   ├── common/    # Reusable step definitions
│   │   └── discover/  # Discover-specific steps
│   └── support/       # Test support files
│       └── world.ts   # Custom World context
├── reports/           # Test reports (generated)
├── cucumber.config.js # Cucumber configuration
├── tsconfig.json      # TypeScript configuration
└── package.json       # Dependencies and scripts

## Prerequisites

- Node.js 20, 22, or >=24
- Dev server running on `http://localhost:3010` (or set `BASE_URL` env var)

## Installation

Install dependencies:

```bash
cd e2e
pnpm install
````

Install Playwright browsers:

```bash
npx playwright install chromium
```

## Running Tests

Run all tests:

```bash
npm test
```

Run tests in headed mode (see browser):

```bash
npm run test:headed
```

Run only smoke tests:

```bash
npm run test:smoke
```

Run discover tests:

```bash
npm run test:discover
```

## Environment Variables

- `BASE_URL`: Base URL for the application (default: `http://localhost:3010`)
- `PORT`: Port number (default: `3010`)
- `HEADLESS`: Run browser in headless mode (default: `true`, set to `false` to see browser)

Example:

```bash
HEADLESS=false BASE_URL=http://localhost:3000 npm run test:smoke
```

## Writing Tests

### Feature Files

Feature files are written in Gherkin syntax and placed in the `src/features/` directory:

```gherkin
@discover @smoke
Feature: Discover Smoke Tests
  Critical path tests to ensure the discover module is functional

  @DISCOVER-SMOKE-001 @P0
  Scenario: Load discover assistant list page
    Given I navigate to "/discover/assistant"
    Then the page should load without errors
    And I should see the page body
    And I should see the search bar
    And I should see assistant cards
```

### Step Definitions

Step definitions are TypeScript files in the `src/steps/` directory that implement the steps from feature files:

```typescript
import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { CustomWorld } from '../../support/world';

Given('I navigate to {string}', async function (this: CustomWorld, path: string) {
  await this.page.goto(path);
  await this.page.waitForLoadState('domcontentloaded');
});
```

## Test Reports

After running tests, HTML and JSON reports are generated in the `reports/` directory:

- `reports/cucumber-report.html` - Human-readable HTML report
- `reports/cucumber-report.json` - Machine-readable JSON report

## Troubleshooting

### Browser not found

If you see errors about missing browser executables:

```bash
npx playwright install chromium
```

### Port already in use

Make sure the dev server is running on the expected port (3010 by default), or set `PORT` or `BASE_URL` environment variable.

### Test timeout

Increase timeout in `cucumber.config.js` or `src/steps/hooks.ts`:

```typescript
setDefaultTimeout(120000); // 2 minutes
```
