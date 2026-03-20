import type { Context } from 'hono';

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
  /**
   * Retrieves the currently logged-in user's information
   * @param c Hono Context
   * @returns User public information response
   */
  async getCurrentUser(c: Context): Promise<Response> {
    try {
      // Get database connection and create service instance
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c));
      const userInfo = await userService.getCurrentUser();

      return this.success(c, userInfo, '获取用户信息成功');
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
      const userService = new UserService(db, this.getUserId(c));

      const userList = await userService.queryUsers(request);

      return this.success(c, userList, '获取用户列表成功');
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
      const userService = new UserService(db, this.getUserId(c));
      const newUser = await userService.createUser(userData);

      return this.success(c, newUser, '用户创建成功');
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
      const userService = new UserService(db, this.getUserId(c));
      const user = await userService.getUserById(id);

      return this.success(c, user, '获取用户信息成功');
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
      const userService = new UserService(db, this.getUserId(c));
      const updatedUser = await userService.updateUser(id, userData);

      return this.success(c, updatedUser, '用户信息更新成功');
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
      const userService = new UserService(db, this.getUserId(c));
      const result = await userService.deleteUser(id);

      return this.success(c, result, '用户删除成功');
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
        return this.error(c, '请求体不能为空', 400);
      }

      // Get database connection and create service instance
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c));
      const result = await userService.updateUserRoles(id, body);

      return this.success(c, result, '用户角色更新成功');
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
      const userService = new UserService(db, this.getUserId(c));
      const result = await userService.clearUserRoles(id);

      return this.success(c, result, '已清空用户角色');
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
      const userService = new UserService(db, this.getUserId(c));
      const userRoles = await userService.getUserRoles(id);

      return this.success(c, userRoles, '获取用户角色成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
