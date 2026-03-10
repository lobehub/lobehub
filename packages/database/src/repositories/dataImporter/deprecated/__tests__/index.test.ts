// @vitest-environment node
import type { ImporterEntryData } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  agents,
  agentsToSessions,
  messages,
  sessionGroups,
  sessions,
  topics,
  users,
} from '@/database/schemas';

import { getTestDB } from '../../../../core/getTestDB';
import { DeprecatedDataImporterRepos as DataImporterRepos } from '../index';
import mockImportData from './fixtures/messages.json';

const CURRENT_CONFIG_VERSION = 7;

const serverDB = await getTestDB();

const userId = 'test-user-id';
let importer: DataImporterRepos;

beforeEach(async () => {
  await serverDB.delete(users);

  // 创建测试数据
  await serverDB.transaction(async (tx) => {
    await tx.insert(users).values({ id: userId });
  });

  importer = new DataImporterRepos(serverDB, userId);
});

describe('DataImporter', () => {
  describe('import sessionGroups', () => {
    it('should import session groups and return correct result', async () => {
      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        sessionGroups: [
          { id: 'group1', name: 'Group 1', createdAt: 1715186011586, updatedAt: 1715186015053 },
          { id: 'group2', name: 'Group 2', createdAt: 1715186011586, updatedAt: 1715186015053 },
        ],
      };

      const result = await importer.importData(data);

      expect(result.sessionGroups.added).toBe(2);
      expect(result.sessionGroups.skips).toBe(0);
      expect(result.sessionGroups.errors).toBe(0);

      const groups = await serverDB.query.sessionGroups.findMany({
        where: eq(sessionGroups.userId, userId),
      });
      expect(groups).toHaveLength(2);
    });

    it('should skip existing session groups and return correct result', async () => {
      await serverDB
        .insert(sessionGroups)
        .values({ clientId: 'group1', name: 'Existing Group', userId });

      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        sessionGroups: [
          { id: 'group1', name: 'Group 1', createdAt: 1715186011586, updatedAt: 1715186015053 },
          { id: 'group2', name: 'Group 2', createdAt: 1715186011586, updatedAt: 1715186015053 },
        ],
      };

      const result = await importer.importData(data);

      expect(result.sessionGroups.added).toBe(1);
      expect(result.sessionGroups.skips).toBe(1);
      expect(result.sessionGroups.errors).toBe(0);
    });
  });

  describe('import sessions', () => {
    it('should import sessions and return correct result', async () => {
      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        sessions: [
          {
            id: 'session1',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 1',
            },
          },
          {
            id: 'session2',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 2',
            },
          },
        ],
      };

      const result = await importer.importData(data);

      expect(result.sessions.added).toBe(2);
      expect(result.sessions.skips).toBe(0);
      expect(result.sessions.errors).toBe(0);

      const importedSessions = await serverDB.query.sessions.findMany({
        where: eq(sessions.userId, userId),
      });
      expect(importedSessions).toHaveLength(2);

      const agentCount = await serverDB.query.agents.findMany({
        where: eq(agents.userId, userId),
      });

      expect(agentCount.length).toBe(2);

      const agentSessionCount = await serverDB.query.agentsToSessions.findMany();
      expect(agentSessionCount.length).toBe(2);
    });

    it('should skip existing sessions and return correct result', async () => {
      await serverDB.insert(sessions).values({ clientId: 'session1', userId });

      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        sessions: [
          {
            id: 'session1',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 1',
            },
          },
          {
            id: 'session2',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 2',
            },
          },
        ],
      };

      const result = await importer.importData(data);

      expect(result.sessions.added).toBe(1);
      expect(result.sessions.skips).toBe(1);
      expect(result.sessions.errors).toBe(0);
    });

    it('should associate imported sessions with session groups', async () => {
      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        sessionGroups: [
          { id: 'group1', name: 'Group 1', createdAt: 1715186011586, updatedAt: 1715186015053 },
          { id: 'group2', name: 'Group 2', createdAt: 1715186011586, updatedAt: 1715186015053 },
        ],
        sessions: [
          {
            id: 'session1',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            group: 'group1',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 1',
            },
          },
          {
            id: 'session2',
            group: 'group2',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 2',
            },
          },
          {
            id: 'session3',
            group: 'group4',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 3',
            },
          },
        ],
      };

      const result = await importer.importData(data);

      expect(result.sessionGroups.added).toBe(2);
      expect(result.sessionGroups.skips).toBe(0);

      expect(result.sessions.added).toBe(3);
      expect(result.sessions.skips).toBe(0);

      // session 1 should be associated with group 1
      const session1 = await serverDB.query.sessions.findFirst({
        where: eq(sessions.clientId, 'session1'),
        with: { group: true },
      });
      expect(session1?.group).toBeDefined();

      // session 3 should not have group
      const session3 = await serverDB.query.sessions.findFirst({
        where: eq(sessions.clientId, 'session3'),
        with: { group: true },
      });
      expect(session3?.group).toBeNull();
    });

    it('should create agents and associate them with imported sessions', async () => {
      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        sessions: [
          {
            id: 'session1',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'Test Agent 1',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 1',
            },
          },
          {
            id: 'session2',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'def',
              chatConfig: {} as any,
              params: {},
              systemRole: 'Test Agent 2',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 2',
            },
          },
        ],
      };

      await importer.importData(data);

      // 验证是否为每个 session 创建了对应的 agent
      const agentCount = await serverDB.query.agents.findMany({
        where: eq(agents.userId, userId),
      });
      expect(agentCount).toHaveLength(2);

      // 验证 agent 的属性是否正确设置
      const agent1 = await serverDB.query.agents.findFirst({
        where: eq(agents.systemRole, 'Test Agent 1'),
      });
      expect(agent1?.model).toBe('abc');

      const agent2 = await serverDB.query.agents.findFirst({
        where: eq(agents.systemRole, 'Test Agent 2'),
      });
      expect(agent2?.model).toBe('def');

      // 验证 agentsToSessions 关联是否正确建立
      const session1 = await serverDB.query.sessions.findFirst({
        where: eq(sessions.clientId, 'session1'),
      });
      const session1Agent = await serverDB.query.agentsToSessions.findFirst({
        where: eq(agentsToSessions.sessionId, session1?.id!),
        with: { agent: true },
      });

      expect((session1Agent?.agent as any).systemRole).toBe('Test Agent 1');

      const session2 = await serverDB.query.sessions.findFirst({
        where: eq(sessions.clientId, 'session2'),
      });
      const session2Agent = await serverDB.query.agentsToSessions.findFirst({
        where: eq(agentsToSessions.sessionId, session2?.id!),
        with: { agent: true },
      });

      expect((session2Agent?.agent as any).systemRole).toBe('Test Agent 2');
    });

    it('should not create duplicate agents for existing sessions', async () => {
      // 先导入一些 sessions
      await importer.importData({
        sessions: [
          {
            id: 'session1',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'Test Agent 1',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 1',
            },
          },
        ],
        version: CURRENT_CONFIG_VERSION,
      });

      // 再次导入相同的 sessions
      await importer.importData({
        sessions: [
          {
            id: 'session1',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'Test Agent 1',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 1',
            },
          },
        ],
        version: CURRENT_CONFIG_VERSION,
      });

      // 验证只创建了一个 agent
      const agentCount = await serverDB.query.agents.findMany({
        where: eq(agents.userId, userId),
      });
      expect(agentCount).toHaveLength(1);
    });
  });

  describe('import topics', () => {
    it('should import topics and return correct result', async () => {
      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        topics: [
          {
            id: 'topic1',
            title: 'Topic 1',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
            sessionId: 'session1',
          },
          {
            id: 'topic2',
            title: 'Topic 2',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
            sessionId: 'session2',
          },
        ],
        sessions: [
          {
            id: 'session1',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 1',
            },
          },
          {
            id: 'session2',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
              openingMessage: `Hello, I'm Agent 2, learn more from [xxx](https://xxx.com)`,
            },
            meta: {
              title: 'Session 2',
            },
          },
        ],
      };

      const result = await importer.importData(data);

      expect(result.topics.added).toBe(2);
      expect(result.topics.skips).toBe(0);
      expect(result.topics.errors).toBe(0);

      const importedTopics = await serverDB.query.topics.findMany({
        where: eq(topics.userId, userId),
      });
      expect(importedTopics).toHaveLength(2);
    });

    it('should skip existing topics and return correct result', async () => {
      await serverDB.insert(topics).values({ clientId: 'topic1', title: 'Existing Topic', userId });

      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        topics: [
          { id: 'topic1', title: 'Topic 1', createdAt: 1715186011586, updatedAt: 1715186015053 },
          { id: 'topic2', title: 'Topic 2', createdAt: 1715186011586, updatedAt: 1715186015053 },
        ],
      };

      const result = await importer.importData(data);
      expect(result.topics.added).toBe(1);
      expect(result.topics.skips).toBe(1);
      expect(result.topics.errors).toBe(0);
    });

    it('should associate imported topics with sessions', async () => {
      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        sessions: [
          {
            id: 'session1',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 1',
            },
          },
        ],
        topics: [
          {
            id: 'topic1',
            title: 'Topic 1',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
            sessionId: 'session1',
          },
          { id: 'topic2', title: 'Topic 2', createdAt: 1715186011586, updatedAt: 1715186015053 },
        ],
      };

      await importer.importData(data);

      // topic1 should be associated with session1
      const [topic1] = await serverDB
        .select({ sessionClientId: sessions.clientId })
        .from(topics)
        .where(eq(topics.clientId, 'topic1'))
        .leftJoin(sessions, eq(topics.sessionId, sessions.id));

      expect(topic1?.sessionClientId).toBe('session1');

      // topic2 should not have session
      const topic2 = await serverDB.query.topics.findFirst({
        where: eq(topics.clientId, 'topic2'),
        with: { session: true },
      });
      expect(topic2?.session).toBeNull();
    });
  });

  describe('import messages', () => {
    it('should import messages and return correct result', async () => {
      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        messages: [
          {
            id: 'msg1',
            content: 'Message 1',
            role: 'user',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
            sessionId: 'session1',
            topicId: 'topic1',
          },
          {
            id: 'msg2',
            content: 'Message 2',
            role: 'assistant',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
            sessionId: 'session1',
            topicId: 'topic1',
            parentId: 'msg1',
          },
        ],
        sessions: [
          {
            id: 'session1',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 1',
            },
          },
        ],
        topics: [
          {
            id: 'topic1',
            title: 'Topic 1',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
            sessionId: 'session1',
          },
        ],
      };

      const result = await importer.importData(data);

      expect(result.messages.added).toBe(2);
      expect(result.messages.skips).toBe(0);
      expect(result.messages.errors).toBe(0);

      const importedMessages = await serverDB.query.messages.findMany({
        where: eq(messages.userId, userId),
      });
      expect(importedMessages).toHaveLength(2);
    });

    it('should skip existing messages and return correct result', async () => {
      await serverDB.insert(messages).values({
        clientId: 'msg1',
        content: 'Existing Message',
        role: 'user',
        userId,
      });

      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        messages: [
          {
            id: 'msg1',
            content: 'Message 1',
            role: 'user',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
          },
          {
            id: 'msg2',
            content: 'Message 2',
            role: 'assistant',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
          },
        ],
      };

      const result = await importer.importData(data);

      expect(result.messages.added).toBe(1);
      expect(result.messages.skips).toBe(1);
      expect(result.messages.errors).toBe(0);
    });

    it('should associate imported messages with sessions and topics', async () => {
      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        sessions: [
          {
            id: 'session1',
            createdAt: '2022-05-14T18:18:10.494Z',
            updatedAt: '2023-01-01',
            type: 'agent',
            config: {
              model: 'abc',
              chatConfig: {} as any,
              params: {},
              systemRole: 'abc',
              tts: {} as any,
              openingQuestions: [],
            },
            meta: {
              title: 'Session 1',
            },
          },
        ],
        topics: [
          {
            id: 'topic1',
            title: 'Topic 1',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
            sessionId: 'session1',
          },
        ],
        messages: [
          {
            id: 'msg1',
            content: 'Message 1',
            role: 'user',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
            sessionId: 'session1',
            topicId: 'topic1',
          },
          {
            id: 'msg2',
            content: 'Message 2',
            role: 'assistant',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
            sessionId: 'session1',
            topicId: 'topic1',
            parentId: 'msg1',
          },
          {
            id: 'msg3',
            content: 'Message 3',
            role: 'user',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
          },
        ],
      };

      await importer.importData(data);

      // msg1 and msg2 should be associated with session1 and topic1
      const [msg1, msg2] = await serverDB.query.messages.findMany({
        where: inArray(messages.clientId, ['msg1', 'msg2']),
        with: {
          session: true,
          topic: true,
        },
      });

      expect(msg1.session?.clientId).toBe('session1');
      expect(msg1.topic?.clientId).toBe('topic1');
      expect(msg2.session?.clientId).toBe('session1');
      expect(msg2.topic?.clientId).toBe('topic1');

      // msg3 should not have session and topic
      const msg3 = await serverDB.query.messages.findFirst({
        where: eq(messages.clientId, 'msg3'),
        with: {
          session: true,
          topic: true,
        },
      });
      expect(msg3?.session).toBeNull();
      expect(msg3?.topic).toBeNull();
    });

    it('should set parentId for messages', async () => {
      const data: ImporterEntryData = {
        version: CURRENT_CONFIG_VERSION,
        messages: [
          {
            id: 'msg1',
            content: 'Message 1',
            role: 'user',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
          },
          {
            id: 'msg2',
            content: 'Message 2',
            role: 'assistant',
            createdAt: 1715186011586,
            updatedAt: 1715186015053,
            parentId: 'msg1',
          },
        ],
      };

      await importer.importData(data);

      const msg2 = await serverDB.query.messages.findFirst({
        where: eq(messages.clientId, 'msg2'),
        with: { parent: true },
      });

      expect(msg2?.parent?.clientId).toBe('msg1');
    });

    it('should import parentId Success', () => {});
  });

  describe(
    'real world examples',
    () => {
      it('should import successfully', async () => {
        const result = await importer.importData({
          messages: [
            {
              role: 'user',
              content: 'hello',
              files: [],
              sessionId: 'inbox',
              topicId: '2wcF8yaS',
              createdAt: 1714236590340,
              id: 'DCG1G1EH',
              updatedAt: 1714236590340,
              extra: {},
            },
            {
              role: 'assistant',
              content: '...',
              parentId: 'DCG1G1EH',
              sessionId: 'inbox',
              topicId: '2wcF8yaS',
              createdAt: 1714236590441,
              id: 'gY41w5vQ',
              updatedAt: 1714236590518,
              error: {
                body: {
                  error: {
                    message: "model 'mixtral' not found, try pulling it first",
                    name: 'ResponseError',
                    status_code: 404,
                  },
                  provider: 'ollama',
                },
                message:
                  'Error requesting Ollama service, please troubleshoot or retry based on the following information',
                type: 'OllamaBizError',
              },
              extra: { fromModel: 'mixtral', fromProvider: 'ollama' },
            },
            {
              role: 'user',
              content: 'hello',
              files: [],
              sessionId: 'a5fefc88-f6c1-44fb-9e98-3d366b1ed589',
              topicId: 'v38snJ0A',
              createdAt: 1717080410895,
              id: 'qOIxEGEB',
              updatedAt: 1717080410895,
              extra: {},
            },
            {
              role: 'assistant',
              content: '...',
              parentId: 'qOIxEGEB',
              sessionId: 'a5fefc88-f6c1-44fb-9e98-3d366b1ed589',
              topicId: 'v38snJ0A',
              createdAt: 1717080410970,
              id: 'w28FcqY5',
              updatedAt: 1717080411485,
              error: {
                body: { error: { errorType: 'NoOpenAIAPIKey' }, provider: 'openai' },
                message: 'OpenAI API Key is empty, please add a custom OpenAI API Key',
                type: 'NoOpenAIAPIKey',
              },
              extra: { fromModel: 'gpt-3.5-turbo', fromProvider: 'openai' },
            },
          ],
          sessionGroups: [
            {
              name: 'Writter',
              sort: 0,
              createdAt: 1706114744425,
              id: 'XlUbvOvL',
              updatedAt: 1706114747468,
            },
          ],
          sessions: [
            {
              config: {
                model: 'gpt-3.5-turbo',
                params: {
                  frequency_penalty: 0,
                  presence_penalty: 0,
                  temperature: 0.6,
                  top_p: 1,
                },
                plugins: [],
                systemRole:
                  "You are a LobeChat technical operator 🍐🐊. You now need to write a developer's guide for LobeChat as a guide for them to develop LobeChat. This guide will include several sections, and you need to output the corresponding document content based on the user's input.\n\nHere is the technical introduction of LobeChat\n\n    LobeChat is an AI conversation application built with the Next.js framework. It uses a series of technology stacks to implement various functions and features.\n\n\n    ## Basic Technology Stack\n\n    The core technology stack of LobeChat is as follows:\n\n    - **Framework**: We chose [Next.js](https://nextjs.org/), a powerful React framework that provides key features such as server-side rendering, routing framework, and Router Handler for our project.\n    - **Component Library**: We use [Ant Design (antd)](https://ant.design/) as the basic component library, and introduce [lobe-ui](https://github.com/lobehub/lobe-ui) as our business component library.\n    - **State Management**: We use [zustand](https://github.com/pmndrs/zustand), a lightweight and easy-to-use state management library.\n    - **Network Request**: We adopt [swr](https://swr.vercel.app/), a React Hooks library for data fetching.\n    - **Routing**: We directly use the routing solution provided by [Next.js](https://nextjs.org/) itself.\n    - **Internationalization**: We use [i18next](https://www.i18next.com/) to implement multi-language support for the application.\n    - **Styling**: We use [antd-style](https://github.com/ant-design/antd-style), a CSS-in-JS library that is compatible with Ant Design.\n    - **Unit Testing**: We use [vitest](https://github.com/vitejs/vitest) for unit testing.\n\n    ## Folder Directory Structure\n\n    The folder directory structure of LobeChat is as follows:\n\n    \\`\\`\\`bash\n    src\n    ├── app        # Main logic and state management related code of the application\n    ├── components # Reusable UI components\n    ├── config     # Application configuration files, including client environment variables and server environment variables\n    ├── const      # Used to define constants, such as action types, route names, etc.\n    ├── features   # Function modules related to business functions, such as Agent settings, plugin development pop-ups, etc.\n    ├── hooks      # Custom utility Hooks reused throughout the application\n    ├── layout     # Layout components of the application, such as navigation bar, sidebar, etc.\n    ├── locales    # Language files for internationalization\n    ├── services   # Encapsulated backend service interfaces, such as HTTP requests\n    ├── store      # Zustand store for state management\n    ├── types      # TypeScript type definition files\n    └── utils      # Common utility functions\n    \\`\\`\\`\n",
                tts: {
                  showAllLocaleVoice: false,
                  sttLocale: 'auto',
                  ttsService: 'openai',
                  voice: { openai: 'alloy' },
                },
                chatConfig: {
                  autoCreateTopicThreshold: 2,
                  enableAutoCreateTopic: true,
                  historyCount: 1,
                },
                openingQuestions: ['Question 1', 'Question 2'],
                openingMessage: `Hello, I'm Agent 1, learn more from [xxx](https://xxx.com)`,
              },
              group: 'XlUbvOvL',
              meta: {
                avatar: '📝',
                description:
                  'LobeChat is an AI conversation application built with the Next.js framework. I will help you write the development documentation for LobeChat.',
                tags: [
                  'Development Documentation',
                  'Technical Introduction',
                  'next-js',
                  'react',
                  'lobe-chat',
                ],
                title: 'LobeChat Technical Documentation Expert',
              },
              type: 'agent',
              createdAt: '2024-01-24T16:43:12.164Z',
              id: 'a5fefc88-f6c1-44fb-9e98-3d366b1ed589',
              updatedAt: '2024-01-24T16:46:15.226Z',
              pinned: false,
            },
          ],
          topics: [
            {
              title: 'Default Topic',
              sessionId: 'inbox',
              createdAt: 1714236590531,
              id: '2wcF8yaS',
              updatedAt: 1714236590531,
            },
            {
              title: 'Default Topic',
              sessionId: 'a5fefc88-f6c1-44fb-9e98-3d366b1ed589',
              createdAt: 1717080410825,
              id: 'v38snJ0A',
              updatedAt: 1717080410825,
            },
          ],
          version: mockImportData.version,
        });

        expect(result).toEqual({
          sessionGroups: { added: 1, errors: 0, skips: 0 },
          sessions: { added: 1, errors: 0, skips: 0 },
          topics: { added: 2, errors: 0, skips: 0 },
          messages: { added: 4, errors: 0, skips: 0 },
        });
      });

      it('should import real world data', async () => {
        const result = await importer.importData({
          ...(mockImportData.state as any),
          version: mockImportData.version,
        });

        expect(result).toEqual({
          sessionGroups: { added: 2, errors: 0, skips: 0 },
          sessions: { added: 15, errors: 0, skips: 0 },
          topics: { added: 4, errors: 0, skips: 0 },
          messages: { added: 32, errors: 0, skips: 0 },
        });
      });
    },
    { timeout: 15000 },
  );
});
