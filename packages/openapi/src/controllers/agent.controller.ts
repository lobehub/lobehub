import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import {
  AGENT_SHARE_DELETE_SIGNAL_HEADER,
  AGENT_SHARE_RESET_SIGNAL_HEADER,
} from '../const/shareResetSignal';
import { AgentService } from '../services/agent.service';
import type {
  AgentDeleteRequest,
  CreateAgentRequest,
  GetAgentsRequest,
  UpdateAgentRequest,
} from '../types/agent.type';

/**
 * Agent controller class
 * Handles Agent-related HTTP requests and responses
 */
export class AgentController extends BaseController {
  /**
   * Retrieves a list of all Agents in the system
   * GET /api/v1/agents/list
   * @param c Hono Context
   * @returns Agent list response
   */
  async queryAgents(c: Context): Promise<Response> {
    try {
      const request = await this.getQuery<GetAgentsRequest>(c);

      const db = await this.getDatabase();
      const agentService = new AgentService(db, this.getUserId(c), this.getWorkspaceId(c));
      const agentsList = await agentService.queryAgents(request);

      return this.success(c, agentsList, 'Agent list retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Creates an agent
   * POST /api/v1/agents/create
   * @param c Hono Context
   * @returns Created Agent information response
   */
  async createAgent(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateAgentRequest>(c);

      const db = await this.getDatabase();
      const agentService = new AgentService(db, this.getUserId(c), this.getWorkspaceId(c));
      const createdAgent = await agentService.createAgent(body);

      return this.success(c, createdAgent, 'Agent created successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Updates an agent
   * PUT /api/v1/agents/:id
   * @param c Hono Context
   * @returns Updated Agent information response
   */
  async updateAgent(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdateAgentRequest>(c);

      const updateRequest: UpdateAgentRequest = {
        ...body,
        id,
      };

      const db = await this.getDatabase();
      const agentService = new AgentService(db, this.getUserId(c), this.getWorkspaceId(c));
      const updatedAgent = await agentService.updateAgent(updateRequest, {
        // `packages/openapi` cannot reach `AiAgentService` (apps/server) to
        // interrupt in-flight visitor runs itself — signal the reset via a
        // response header instead, so the process that mounts this Hono app
        // (`src/app/(backend)/api/v1/[[...route]]/route.ts`, which DOES have
        // `@/server/*` access) can schedule the interrupt after the response
        // is built. Stripped from the response before it reaches the API
        // caller — see that route file. See LOBE-11930 hole 2.
        onShareReset: ({ agentId, ownerId }) => {
          c.header(AGENT_SHARE_RESET_SIGNAL_HEADER, `${ownerId}:${agentId}`);
        },
      });

      return this.success(c, updatedAgent, 'Agent updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Deletes an agent
   * DELETE /api/v1/agents/delete
   * @param c Hono Context
   * @returns Deletion result response
   */
  async deleteAgent(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const request: AgentDeleteRequest = { agentId: id };

      const db = await this.getDatabase();
      const ownerId = this.getUserId(c);
      const agentService = new AgentService(db, ownerId, this.getWorkspaceId(c));
      await agentService.deleteAgent(request, {
        // `packages/openapi` cannot reach `AiAgentService` (apps/server) to
        // interrupt in-flight Agent Share visitor runs itself — signal the
        // pre-snapshotted run list via a response header instead, so the
        // process that mounts this Hono app
        // (`src/app/(backend)/api/v1/[[...route]]/route.ts`, which DOES have
        // `@/server/*` access) can schedule the interrupt after the response
        // is built. Stripped from the response before it reaches the API
        // caller — see that route file. See LOBE-11930.
        onShareRunsInterrupted: (activeShareRuns) => {
          if (!ownerId) return;
          c.header(AGENT_SHARE_DELETE_SIGNAL_HEADER, JSON.stringify({ activeShareRuns, ownerId }));
        },
      });

      return this.success(c, null, 'Agent deleted successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves Agent details by ID
   * GET /api/v1/agents/:id
   * @param c Hono Context
   * @returns Agent detail response
   */
  async getAgentById(c: Context): Promise<Response> {
    try {
      const { id: agentId } = this.getParams<{ id: string }>(c);
      const db = await this.getDatabase();
      const agentService = new AgentService(db, this.getUserId(c), this.getWorkspaceId(c));
      const agent = await agentService.getAgentById(agentId);

      if (!agent) {
        return this.error(c, 'Agent not found', 404);
      }

      return this.success(c, agent, 'Agent details retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
