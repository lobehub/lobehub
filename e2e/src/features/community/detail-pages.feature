@community @detail
Feature: Discover Detail Pages
  Tests for detail pages in the discover module

  Background:
    Given the application is running

  # ============================================
  # Assistant Detail Page
  # ============================================

  @COMMUNITY-DETAIL-001 @P1
  Scenario: Load assistant detail page and verify content
    Given I navigate to "/community/agent"
    And I wait for the page to fully load
    When I click on the first assistant card
    Then I should be on an assistant detail page
    And I should see the assistant title
    And I should see the assistant description
    And I should see the assistant author information
    And I should see the add to workspace button

  @COMMUNITY-DETAIL-002 @P1
  Scenario: Navigate back from assistant detail page
    Given I navigate to "/community/agent"
    And I wait for the page to fully load
    And I click on the first assistant card
    When I click the back button
    Then I should be on the assistant list page

  # ============================================
  # Model Detail Page
  # ============================================

  @COMMUNITY-DETAIL-003 @P1
  Scenario: Load model detail page and verify content
    Given I navigate to "/community/model"
    And I wait for the page to fully load
    When I click on the first model card
    Then I should be on a model detail page
    And I should see the model title
    And I should see the model description
    And I should see the model parameters information

  @COMMUNITY-DETAIL-004 @P1
  Scenario: Navigate back from model detail page
    Given I navigate to "/community/model"
    And I wait for the page to fully load
    And I click on the first model card
    When I click the back button
    Then I should be on the model list page

  # ============================================
  # Provider Detail Page
  # ============================================

  @COMMUNITY-DETAIL-005 @P1
  Scenario: Load provider detail page and verify content
    Given I navigate to "/community/provider"
    And I wait for the page to fully load
    When I click on the first provider card
    Then I should be on a provider detail page
    And I should see the provider title
    And I should see the provider description
    And I should see the provider website link

  @COMMUNITY-DETAIL-006 @P1
  Scenario: Navigate back from provider detail page
    Given I navigate to "/community/provider"
    And I wait for the page to fully load
    And I click on the first provider card
    When I click the back button
    Then I should be on the provider list page

  # ============================================
  # MCP Detail Page
  # ============================================

  @COMMUNITY-DETAIL-007 @P1
  Scenario: Load MCP detail page and verify content
    Given I navigate to "/community/mcp"
    And I wait for the page to fully load
    When I click on the first MCP card
    Then I should be on an MCP detail page
    And I should see the MCP title
    And I should see the MCP description
    And I should see the install button

  @COMMUNITY-DETAIL-008 @P1
  Scenario: Navigate back from MCP detail page
    Given I navigate to "/community/mcp"
    And I wait for the page to fully load
    And I click on the first MCP card
    When I click the back button
    Then I should be on the MCP list page
