import type { Context } from 'hono';

import { type ApiKeyScope, hasApiKeyScope, isFullAccessApiKey } from '@/const/apiKeyScope';

import { BaseController } from '../common/base.controller';
import { UserService } from '../services';
import type {
  CreateUserRequest,
  UpdateUserRequest,
  UpdateUserRolesRequest,
  UserListRequest,
} from '../types/user.type';

/**
 * User controller class
 * Handles user-related HTTP requests and responses
 */
export class UserController extends BaseController {
  /** Session / OIDC callers and full-access keys hold every scope implicitly. */
  private callerHasScope(c: Context, scope: ApiKeyScope): boolean {
    if (c.get('authType') !== 'apikey') return true;

    const scopes = c.get('apiKeyScopes') as string[] | null | undefined;
    return isFullAccessApiKey(scopes) || hasApiKeyScope(scopes, scope);
  }

  /**
   * `/me` is reachable by every authenticated caller so a key can resolve its
   * own identity — `lh login` depends on it (LOBE-12934). What it *returns*
   * is still scoped, because identity bootstrap needs an id, not a profile:
   *
   * - without `user:read` the response is narrowed to the id, keeping the
   *   caller's email, phone, preferences and role names out of a key that was
   *   only granted, say, `model:invoke`
   * - `messageCount` is chat-usage metadata and additionally needs `chat:read`
   *
   * Narrowed rather than rejected throughout: `includeCount` defaults to true,
   * so answering with 403 would make identity resolution depend on a query
   * parameter — the exact trap this endpoint just came out of.
   */
  async getCurrentUser(c: Context): Promise<Response> {
    try {
      const includeCountQuery = c.req.query('includeCount');
      const countRequested = includeCountQuery !== '0' && includeCountQuery !== 'false';
      const includeCount = countRequested && this.callerHasScope(c, 'chat:read');

      // Get database connection and create service instance
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c), this.getWorkspaceId(c));
      const userInfo = await userService.getCurrentUser(includeCount);

      return this.success(
        c,
        this.callerHasScope(c, 'user:read') ? userInfo : { id: userInfo?.id },
        'User info retrieved successfully',
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves the user list (supports search and pagination)
   * @param c Hono Context
   * @returns User list response
   */
  async queryUsers(c: Context): Promise<Response> {
    try {
      const request = this.getQuery<UserListRequest>(c);

      // Get database connection and create service instance
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c), this.getWorkspaceId(c));

      const userList = await userService.queryUsers(request);

      return this.success(c, userList, 'User list retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Creates a new user
   * @param c Hono Context
   * @returns Created user information response
   */
  async createUser(c: Context): Promise<Response> {
    try {
      const userData = await this.getBody<CreateUserRequest>(c);

      // Get database connection and create service instance
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c), this.getWorkspaceId(c));
      const newUser = await userService.createUser(userData);

      return this.success(c, newUser, 'User created successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves user details by ID
   * @param c Hono Context
   * @returns User detail response
   */
  async getUserById(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);

      // Get database connection and create service instance
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c), this.getWorkspaceId(c));
      const user = await userService.getUserById(id);

      return this.success(c, user, 'User info retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Updates user information
   * @param c Hono Context
   * @returns Updated user information response
   */
  async updateUser(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const userData = await this.getBody<UpdateUserRequest>(c);

      // Get database connection and create service instance
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c), this.getWorkspaceId(c));
      const updatedUser = await userService.updateUser(id, userData);

      return this.success(c, updatedUser, 'User info updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Deletes a user
   * @param c Hono Context
   * @returns Deletion operation result response
   */
  async deleteUser(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);

      // Get database connection and create service instance
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c), this.getWorkspaceId(c));
      const result = await userService.deleteUser(id);

      return this.success(c, result, 'User deleted successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Updates user roles (RESTful partial update)
   * PATCH /api/v1/users/:id/roles
   * @param c Hono Context
   * @returns User role update response
   */
  async updateUserRoles(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdateUserRolesRequest>(c);

      if (!body) {
        return this.error(c, 'Request body cannot be empty', 400);
      }

      // Get database connection and create service instance
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c), this.getWorkspaceId(c));
      const result = await userService.updateUserRoles(id, body);

      return this.success(c, result, 'User roles updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Clears user roles
   * DELETE /api/v1/users/:id/roles
   */
  async clearUserRoles(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);

      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c), this.getWorkspaceId(c));
      const result = await userService.clearUserRoles(id);

      return this.success(c, result, 'User roles cleared');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves user role information
   * GET /api/v1/users/:id/roles
   * @param c Hono Context
   * @returns User role information response
   */
  async getUserRoles(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);

      // Get database connection and create service instance
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c), this.getWorkspaceId(c));
      const userRoles = await userService.getUserRoles(id);

      return this.success(c, userRoles, 'User roles retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
