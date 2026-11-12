@perf @agent @conversation
Feature: 长对话消息列表的渲染速度预算
  作为用户，打开一个有几百上千条消息的对话时，我希望：
  - 最新一条消息很快出现在屏幕上，可以直接阅读
  - 用滚轮一路翻到最早的消息、再翻回底部的过程中不卡顿
  - 列表只渲染视口附近的消息，不因对话变长而越来越慢

  对话包含工具调用、代码块、图片和表格，预算定义见 e2e/src/performance/budgets.ts。

  Background:
    Given 用户已登录系统

  @PERF-LONG-LIST-001 @P0
  Scenario Outline: 打开 <count> 条消息的对话并滚动到顶、再滚回底部都在预算内
    Given 用户有一个包含 <count> 条消息的长对话
    When 用户打开这个长对话
    Then 最新消息应在首屏可读预算内出现
    When 用户用滚轮从底部滚到对话最早的消息
    Then 这次滚动的帧间隔和消息行挂载数应在预算内
    When 用户用滚轮从顶部滚回对话最新的消息
    Then 这次滚动的帧间隔和消息行挂载数应在预算内

    Examples:
      | count |
      | 500   |
      | 1000  |
