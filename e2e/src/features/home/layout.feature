@journey @home @layout @regression
Feature: Home Dashboard 右栏布局
  作为桌面端用户，我希望窗口变窄时右栏卡片、滚动条与页面边缘仍保持清晰分隔

  Background:
    Given 用户已登录系统

  @HOME-LAYOUT-RAIL-001 @P1
  Scenario: 受限桌面宽度下滚动条位于卡片外侧且保留页面右边距
    Given 用户在受限宽度下打开 Home 页面
    Then Home 右栏应保持卡片、滚动条轨道与页面边缘的分层间距
