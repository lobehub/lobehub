@regression @skill-policy-menu
Feature: 技能策略菜单的图标点击
  作为用户，我希望点击技能策略操作图标时策略可靠更新

  Background:
    Given 用户已登录系统

  @AGENT-SKILL-POLICY-001 @P0
  # Red/green reproduction requires HEADLESS=false; headless Chromium does not reproduce this timing.
  Scenario: 按住策略 SVG 后释放仍会更新策略
    Given 用户进入带 Artifacts 技能的 Agent 对话页面
    When 用户交替按住固定和自动的 SVG 图标 30 次
    Then 每次 SVG 点击都应更新 Artifacts 的真实策略
