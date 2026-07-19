@oidc @regression @smoke @P0
Feature: OIDC Device Flow 原生表单提交

  作为 LobeHub CLI 用户，
  我希望设备确认与权限确认在按钮进入 loading 状态后仍能提交，
  以便 CLI 可以完成授权并取得令牌。

  @OIDC-DEVICE-001
  Scenario: loading 状态不会阻断设备授权表单提交
    Given CLI 已发起 OIDC Device Flow
    When 用户打开设备授权链接
    Then 页面应显示待授权的设备码
    When 用户授权该设备
    Then 应进入 OIDC 授权交互
    When 用户同意 CLI 的权限请求
    Then 应显示设备授权成功页面
    And CLI 应取得 access token 与 refresh token
