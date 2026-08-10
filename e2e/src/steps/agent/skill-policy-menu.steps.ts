import { Given, Then, When } from '@cucumber/cucumber';
import { expect, type Locator } from '@playwright/test';

import type { CustomWorld } from '../../support/world';
import { WAIT_TIMEOUT } from '../../support/world';

const ARTIFACTS_ID = 'lobe-artifacts';
const policyName = {
  auto: /^(自动|Auto)$/i,
  pinned: /^(固定|固定启用|Pin)$/i,
} as const;

const findVisible = async (locator: Locator): Promise<Locator> => {
  await expect
    .poll(
      async () => {
        for (let index = 0; index < (await locator.count()); index += 1) {
          if (
            await locator
              .nth(index)
              .isVisible()
              .catch(() => false)
          )
            return true;
        }
        return false;
      },
      { timeout: WAIT_TIMEOUT },
    )
    .toBe(true);

  for (let index = 0; index < (await locator.count()); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }

  throw new Error('Could not find a visible matching element');
};

const readArtifactsMode = (world: CustomWorld) =>
  world.page.evaluate((identifier) => {
    const testWindow = window as typeof window & {
      __LOBE_STORES?: {
        agent?: () => {
          activeAgentId?: string;
          agentMap?: Record<
            string,
            { plugins?: Array<string | { identifier: string; mode?: string }> }
          >;
        };
      };
    };
    const agentStore = testWindow.__LOBE_STORES?.agent?.();
    const agent = agentStore?.agentMap?.[agentStore.activeAgentId];
    const entry = agent?.plugins?.find(
      (plugin) => (typeof plugin === 'string' ? plugin : plugin.identifier) === identifier,
    );

    if (!entry) return 'auto';
    return typeof entry === 'string' ? 'pinned' : entry.mode;
  }, ARTIFACTS_ID);

const openArtifactsPolicy = async (world: CustomWorld): Promise<void> => {
  await world.page.mouse.move(10, 10);
  await world.page.keyboard.press('Escape');

  const plus = await findVisible(world.page.getByRole('button', { name: /添加文件|Add files/i }));
  await plus.click();
  const skills = await findVisible(
    world.page
      .locator('[role="menuitem"][aria-haspopup="menu"]')
      .filter({ hasText: /技能|Skills/i }),
  );
  await skills.click();

  const search = await findVisible(world.page.getByPlaceholder(/Search skills|搜索技能|搜索/i));
  await search.fill('Artifacts');
  const row = await findVisible(
    world.page
      .locator('[data-submenu] [role="menuitem"]')
      .filter({ hasText: 'Artifacts' })
      .filter({ has: world.page.locator('button[aria-haspopup="dialog"]:not(:disabled)') }),
  );
  await row.hover();
  await row.locator('button[aria-haspopup="dialog"]').click();
};

Given(
  '用户进入带 Artifacts 技能的 Agent 对话页面',
  { timeout: 45_000 },
  async function (this: CustomWorld) {
    await this.page.setViewportSize({ height: 900, width: 1850 });
    await this.page.goto('/agent/inbox', { waitUntil: 'domcontentloaded' });
    await expect(this.page.locator('[data-testid="chat-input"]').first()).toBeVisible({
      timeout: WAIT_TIMEOUT,
    });
    this.testContext.skillPolicyUpdates = 0;
  },
);

When(
  '用户交替按住固定和自动的 SVG 图标 {int} 次',
  { timeout: 120_000 },
  async function (this: CustomWorld, repetitions: number) {
    for (let index = 0; index < repetitions; index += 1) {
      const current = await readArtifactsMode(this);
      const requested = current === 'pinned' ? 'auto' : 'pinned';
      await openArtifactsPolicy(this);

      const action = await findVisible(
        this.page.getByRole('dialog').getByRole('button', { name: policyName[requested] }),
      );
      const icon = action.locator('svg path').first();
      const box = await icon.boundingBox();
      if (!box) throw new Error('Policy SVG path has no clickable bounding box');

      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await this.page.mouse.down();
      // The failing Chrome trace holds for 104–168ms before mouseup.
      await this.page.waitForTimeout(120);
      await this.page.mouse.up();

      await expect.poll(() => readArtifactsMode(this), { timeout: WAIT_TIMEOUT }).toBe(requested);
      this.testContext.skillPolicyUpdates += 1;
    }
  },
);

Then('每次 SVG 点击都应更新 Artifacts 的真实策略', function (this: CustomWorld) {
  expect(this.testContext.skillPolicyUpdates).toBe(30);
});
