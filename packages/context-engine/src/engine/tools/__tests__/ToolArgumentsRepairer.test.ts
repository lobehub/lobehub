import { describe, expect, it } from 'vitest';

import { ToolArgumentsRepairer } from '../ToolArgumentsRepairer';
import type { LobeToolManifest } from '../types';

describe('ToolArgumentsRepairer', () => {
  describe('repair - basic functionality', () => {
    it('should return original parsed data when no schema provided', () => {
      const repairer = new ToolArgumentsRepairer();
      const parsed = { foo: 'bar' };

      const result = repairer.repair(parsed);

      expect(result).toEqual(parsed);
    });

    it('should return original parsed data when schema has no required fields', () => {
      const repairer = new ToolArgumentsRepairer();
      const parsed = { foo: 'bar' };
      const schema = { type: 'object', properties: { foo: { type: 'string' } } };

      const result = repairer.repair(parsed, schema);

      expect(result).toEqual(parsed);
    });

    it('should return original parsed data when all required fields are present', () => {
      const repairer = new ToolArgumentsRepairer();
      const parsed = { description: 'test', instruction: 'do something' };
      const schema = {
        type: 'object',
        required: ['description', 'instruction'],
        properties: {
          description: { type: 'string' },
          instruction: { type: 'string' },
        },
      };

      const result = repairer.repair(parsed, schema);

      expect(result).toEqual(parsed);
    });
  });

  describe('repair - malformed JSON from LLM', () => {
    it('should repair malformed JSON with escaped string issue', () => {
      const repairer = new ToolArgumentsRepairer();

      // This is the malformed data from haiku-4.5 model
      // The entire JSON got stuffed into the "description" field with escaped quotes
      const malformedParsed = {
        description:
          'Synthesize all 10 batch analyses into 10 most important themes for product builders", "instruction": "You have access to 10 batch analysis files", "runInClient": true, "timeout": 120000}',
      };

      const schema = {
        type: 'object',
        required: ['description', 'instruction'],
        properties: {
          description: { type: 'string' },
          instruction: { type: 'string' },
          runInClient: { type: 'boolean' },
          timeout: { type: 'number' },
        },
      };

      const result = repairer.repair(malformedParsed, schema);

      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('instruction');
      expect(result).toHaveProperty('runInClient', true);
      expect(result).toHaveProperty('timeout', 120000);
      expect(result.description).toBe(
        'Synthesize all 10 batch analyses into 10 most important themes for product builders',
      );
      expect(result.instruction).toBe('You have access to 10 batch analysis files');
    });

    it('should return original data if repair fails', () => {
      const repairer = new ToolArgumentsRepairer();

      // Invalid malformed data that cannot be repaired
      const malformedParsed = {
        description: 'some text without proper escape pattern',
      };

      const schema = {
        type: 'object',
        required: ['description', 'instruction'],
        properties: {
          description: { type: 'string' },
          instruction: { type: 'string' },
        },
      };

      const result = repairer.repair(malformedParsed, schema);

      // Should return original since pattern doesn't match
      expect(result).toEqual(malformedParsed);
    });
  });

  describe('parse - integrated parsing and repair', () => {
    it('should parse and repair arguments using manifest schema', () => {
      const manifest: LobeToolManifest = {
        identifier: 'lobe-gtd',
        api: [
          {
            name: 'execTask',
            description: 'Execute async task',
            parameters: {
              type: 'object',
              required: ['description', 'instruction'],
              properties: {
                description: { type: 'string' },
                instruction: { type: 'string' },
                runInClient: { type: 'boolean' },
                timeout: { type: 'number' },
              },
            },
          },
        ],
        type: 'builtin',
      } as unknown as LobeToolManifest;

      const repairer = new ToolArgumentsRepairer(manifest);

      // Malformed arguments string
      const malformedArguments = JSON.stringify({
        description:
          'Test task", "instruction": "Do something important", "runInClient": true, "timeout": 60000}',
      });

      const result = repairer.parse('execTask', malformedArguments);

      expect(result).toHaveProperty('description', 'Test task');
      expect(result).toHaveProperty('instruction', 'Do something important');
      expect(result).toHaveProperty('runInClient', true);
      expect(result).toHaveProperty('timeout', 60000);
    });

    it('should handle normal arguments without repair needed', () => {
      const manifest: LobeToolManifest = {
        identifier: 'test-tool',
        api: [
          {
            name: 'testApi',
            description: 'Test API',
            parameters: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
              },
            },
          },
        ],
        type: 'default',
      } as unknown as LobeToolManifest;

      const repairer = new ToolArgumentsRepairer(manifest);
      const normalArguments = JSON.stringify({ name: 'test value' });

      const result = repairer.parse('testApi', normalArguments);

      expect(result).toEqual({ name: 'test value' });
    });

    it('should handle no manifest gracefully', () => {
      const repairer = new ToolArgumentsRepairer();
      const arguments_ = JSON.stringify({ foo: 'bar' });

      const result = repairer.parse('unknownApi', arguments_);

      expect(result).toEqual({ foo: 'bar' });
    });

    it('should handle invalid JSON gracefully', () => {
      const repairer = new ToolArgumentsRepairer();

      const result = repairer.parse('test', 'invalid json');

      expect(result).toEqual({});
    });
  });
});
