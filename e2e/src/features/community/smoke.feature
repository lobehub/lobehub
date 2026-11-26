@community @smoke
Feature: Community Smoke Tests
  Critical path tests to ensure the community/discover module is functional

  @COMMUNITY-SMOKE-001 @P0
  Scenario: Open the marketplace at the Apps catalog
    Given I navigate to "/marketplace"
    Then the page should load without errors
    And I should see the page body
    And I should be navigated to "/marketplace/app"
    And I should see the catalog titled "Apps"
    And I should see the search bar

  @COMMUNITY-SMOKE-002 @P0
  Scenario: Load Assistant List Page
    Given I navigate to "/marketplace/agent"
    Then the page should load without errors
    And I should see the page body
    And I should see the search bar
    And I should see assistant cards

  @COMMUNITY-SMOKE-006 @P0
  Scenario: Load the community Agents under Public
    Given I navigate to "/marketplace/agent?tab=public"
    Then the page should load without errors
    And I should see the assistant category "programming"
    And I should see assistant cards

  @COMMUNITY-SMOKE-003 @P0
  Scenario: Load Model List Page
    Given I navigate to "/marketplace/model"
    Then the page should load without errors
    And I should see the page body
    And I should see model cards
    And I should see the sort dropdown

  @COMMUNITY-SMOKE-004 @P0
  Scenario: Load Provider List Page
    Given I navigate to "/marketplace/provider"
    Then the page should load without errors
    And I should see the page body
    And I should see provider cards

  @COMMUNITY-SMOKE-005 @P0
  Scenario: Open MCP discovery from the separate Marketplace entry
    Given I navigate to "/marketplace/app"
    When I open the MCP catalog from the Marketplace sidebar
    Then I should be navigated to "/marketplace/mcp"
    And the page should load without errors
    And I should see the catalog titled "MCP Servers"
    And I should see the search bar
    And I should see MCP cards
    And I should see the MCP category "developer"

  @COMMUNITY-SMOKE-006 @P0
  Scenario: Open a legacy MCP catalog link
    Given I navigate to "/community/mcp?category=productivity&q=search"
    Then I should be navigated to "/marketplace/mcp?category=productivity&q=search"
    And the catalog search bar should contain "search"
    And I should see only these MCP cards
      | Web Search |
