@discover @smoke
Feature: Discover Smoke Tests
  Critical path tests to ensure the discover module is functional

  @DISCOVER-SMOKE-001 @P0
  Scenario: Load discover assistant list page
    Given I navigate to "/discover/assistant"
    Then the page should load without errors
    And I should see the page body
    And I should see the search bar
    And I should see assistant cards
