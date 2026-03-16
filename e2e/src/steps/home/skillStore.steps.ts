/**
 * Skill Store Steps
 *
 * Step definitions for opening the Skill Store modal from the Home page.
 * Verifies that clicking the "Add Skills" banner opens the modal without crashing.
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { type CustomWorld, WAIT_TIMEOUT } from '../../support/world';

// ============================================
// Given Steps
// ============================================

Given('用户在首页', async function (this: CustomWorld) {
  console.log('   📍 Step: 导航到首页...');
  await this.page.goto('/');
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await this.page.waitForTimeout(1000);
  console.log('   ✅ 已进入首页');
});

// ============================================
// When Steps
// ============================================

When('用户点击 Add Skills 横幅', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击 Add Skills 横幅...');

  const banner = this.page.locator('[data-testid="skill-install-banner"]').first();
  await expect(banner).toBeVisible({ timeout: WAIT_TIMEOUT });
  await banner.click();

  // Wait for modal open animation
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已点击 Add Skills 横幅');
});

// ============================================
// Then Steps
// ============================================

Then('技能商店模态框应该正常打开', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证技能商店模态框已打开...');

  // The modal should be visible with the title "Skill Store"
  const modal = this.page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: WAIT_TIMEOUT });

  const title = modal.getByText(/Skill Store|技能商店/i).first();
  await expect(title).toBeVisible({ timeout: WAIT_TIMEOUT });

  console.log('   ✅ 技能商店模态框已正常打开');
});

Then('技能商店应该显示 LobeHub 标签页', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证 LobeHub 标签页显示...');

  const modal = this.page.getByRole('dialog');

  // Check that the segmented tabs are visible with LobeHub selected by default
  const lobehubTab = modal.getByText('LobeHub', { exact: true }).first();
  await expect(lobehubTab).toBeVisible({ timeout: WAIT_TIMEOUT });

  // Community and Custom tabs should also be present
  const communityTab = modal.getByText(/Community|社区/i).first();
  await expect(communityTab).toBeVisible({ timeout: WAIT_TIMEOUT });

  const customTab = modal.getByText(/Custom|自定义/i).first();
  await expect(customTab).toBeVisible({ timeout: WAIT_TIMEOUT });

  console.log('   ✅ LobeHub 标签页正常显示');
});
