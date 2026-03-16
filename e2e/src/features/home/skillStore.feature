@journey @home @skill
Feature: Home 页面 Add Skills 打开技能商店
  作为用户，我希望在 Home 页面点击 Add Skills 横幅后能够正常打开技能商店模态框

  Background:
    Given 用户已登录系统

  @HOME-SKILL-STORE-001 @P0 @smoke
  Scenario: 点击 Add Skills 横幅打开技能商店模态框
    Given 用户在首页
    When 用户点击 Add Skills 横幅
    Then 技能商店模态框应该正常打开
    And 技能商店应该显示 LobeHub 标签页
