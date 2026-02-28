import { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { UserService } from '../services';
import {
  CreateUserRequest,
  UpdateUserRequest,
  UpdateUserRolesRequest,
  UserListRequest,
} from '../types/user.type';

/**
 * 用户控制器类
 * 处理用户相关的HTTP请求和响应
 */
export class UserController extends BaseController {
  /**
   * 获取当前登录用户信息
   * @param c Hono Context
   * @returns 用户公开信息响应
   */
  async getCurrentUser(c: Context): Promise<Response> {
    try {
      // 获取数据库连接并创建服务实例
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c));
      const userInfo = await userService.getCurrentUser();

      return this.success(c, userInfo, '获取用户信息成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * 统一获取用户列表 (支持搜索和分页)
   * @param c Hono Context
   * @returns 用户列表响应
   */
  async queryUsers(c: Context): Promise<Response> {
    try {
      const request = this.getQuery<UserListRequest>(c);

      // 获取数据库连接并创建服务实例
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c));

      const userList = await userService.queryUsers(request);

      return this.success(c, userList, '获取用户列表成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * 创建新用户
   * @param c Hono Context
   * @returns 创建的用户信息响应
   */
  async createUser(c: Context): Promise<Response> {
    try {
      const userData = await this.getBody<CreateUserRequest>(c);

      // 获取数据库连接并创建服务实例
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c));
      const newUser = await userService.createUser(userData);

      return this.success(c, newUser, '用户创建成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * 根据ID获取用户详情
   * @param c Hono Context
   * @returns 用户详情响应
   */
  async getUserById(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);

      // 获取数据库连接并创建服务实例
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c));
      const user = await userService.getUserById(id);

      return this.success(c, user, '获取用户信息成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * 更新用户信息
   * @param c Hono Context
   * @returns 更新后的用户信息响应
   */
  async updateUser(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const userData = await this.getBody<UpdateUserRequest>(c);

      // 获取数据库连接并创建服务实例
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c));
      const updatedUser = await userService.updateUser(id, userData);

      return this.success(c, updatedUser, '用户信息更新成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * 删除用户
   * @param c Hono Context
   * @returns 删除操作结果响应
   */
  async deleteUser(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);

      // 获取数据库连接并创建服务实例
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c));
      const result = await userService.deleteUser(id);

      return this.success(c, result, '用户删除成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * 更新用户角色 (RESTful 部分更新)
   * PATCH /api/v1/users/:id/roles
   * @param c Hono Context
   * @returns 用户角色更新响应
   */
  async updateUserRoles(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdateUserRolesRequest>(c);

      if (!body) {
        return this.error(c, '请求体不能为空', 400);
      }

      // 获取数据库连接并创建服务实例
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c));
      const result = await userService.updateUserRoles(id, body);

      return this.success(c, result, '用户角色更新成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * 清空用户角色
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
   * 获取用户角色信息
   * GET /api/v1/users/:id/roles
   * @param c Hono Context
   * @returns 用户角色信息响应
   */
  async getUserRoles(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);

      // 获取数据库连接并创建服务实例
      const db = await this.getDatabase();
      const userService = new UserService(db, this.getUserId(c));
      const userRoles = await userService.getUserRoles(id);

      return this.success(c, userRoles, '获取用户角色成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
