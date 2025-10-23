@routes @smoke
Feature: Core Routes Accessibility
  As a user
  I want all core application routes to be accessible
  So that I can navigate the application without errors

  Background:
    Given the application is running

  @ROUTES-001 @P0
  Scenario Outline: Access core routes without errors
    When I navigate to "<route>"
    Then the response status should be less than 400
    And the page should load without errors
    And I should see the page body
    And the page title should not contain "error" or "not found"

    Examples:
      | route      |
      | /          |
      | /chat      |
      | /discover  |
      | /files     |
      | /repos     |

  @ROUTES-002 @P0
  Scenario Outline: Access settings routes without errors
    When I navigate to "/settings?active=<tab>"
    Then the response status should be less than 400
    And the page should load without errors
    And I should see the page body
    And the page title should not contain "error" or "not found"

    Examples:
      | tab          |
      | about        |
      | agent        |
      | hotkey       |
      | provider     |
      | proxy        |
      | storage      |
      | system-agent |
      | tts          |
