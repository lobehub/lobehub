@journey @home @layout @regression
Feature: Home Dashboard 双列布局
  作为桌面端用户，我希望 Home 内容作为一个整体滚动，且滚动条始终位于内容之外的间距内

  Background:
    Given 用户已登录系统

  @HOME-LAYOUT-RAIL-001 @P1
  Scenario: 受限桌面宽度下 Home 内容整体滚动
    Given 用户在受限宽度下打开 Home 页面
    Then Home 主列与右栏都不应有各自的滚动条
    And Home 滚动应同时带动主列与右栏
    And Home 页面滚动条应位于右栏卡片与页面边缘之间
    And Home 右栏折叠控制应固定在页面右上角
    And Home 开合右栏不应改变主列纵向位置
