/**
 * Market authentication tokens
 */
export interface MarketAuthTokens {
  /**
   * Access token for Market API requests
   */
  accessToken?: string;
  /**
   * Token expiration timestamp (milliseconds since epoch)
   */
  expiresAt?: number;
  /**
   * Refresh token for renewing access tokens
   */
  refreshToken?: string;
}
