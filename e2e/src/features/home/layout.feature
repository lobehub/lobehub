@journey @home @layout @regression
Feature: Home Dashboard 双列布局
  作为桌面端用户，我希望主列与右栏的滚动条始终位于各自的独立间距内

  Background:
    Given 用户已登录系统

  @HOME-LAYOUT-RAIL-001 @P1
  Scenario: 受限桌面宽度下双列滚动条不覆盖内容
    Given 用户在受限宽度下打开 Home 页面
    Then Home 主列滚动条应位于双列间距中央
    And Home 右栏折叠控制应固定在页面右上角
    And Home 开合右栏不应改变主列纵向位置
    And Home 右栏应保持卡片、滚动条轨道与页面边缘的分层间距
