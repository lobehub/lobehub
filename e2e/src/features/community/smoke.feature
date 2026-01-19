@community @smoke
Feature: Community Smoke Tests
  Critical path tests to ensure the community/discover module is functional

  @COMMUNITY-SMOKE-001 @P0
  Scenario: Load Community Home Page
    Given I navigate to "/community"
    Then the page should load without errors
    And I should see the page body
    And I should see the featured assistants section
    And I should see the featured MCP tools section

  @COMMUNITY-SMOKE-002 @P0
  Scenario: Load Assistant List Page
    Given I navigate to "/community/agent"
    Then the page should load without errors
    And I should see the page body
    And I should see the search bar
    And I should see the category menu
    And I should see assistant cards
    And I should see pagination controls

  @COMMUNITY-SMOKE-003 @P0
  Scenario: Load Model List Page
    Given I navigate to "/community/model"
    Then the page should load without errors
    And I should see the page body
    And I should see model cards
    And I should see the sort dropdown

  @COMMUNITY-SMOKE-004 @P0
  Scenario: Load Provider List Page
    Given I navigate to "/community/provider"
    Then the page should load without errors
    And I should see the page body
    And I should see provider cards

  @COMMUNITY-SMOKE-005 @P0
  Scenario: Load MCP List Page
    Given I navigate to "/community/mcp"
    Then the page should load without errors
    And I should see the page body
    And I should see MCP cards
    And I should see the category filter
