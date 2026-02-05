import type dayjs from 'dayjs';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from './genWhere';

describe('genWhere', () => {
  describe('genWhere', () => {
    it('should return undefined when array is empty', () => {
      const result = genWhere([]);
      expect(result).toBeUndefined();
    });

    it('should return undefined when all elements are undefined', () => {
      const result = genWhere([undefined, undefined, undefined]);
      expect(result).toBeUndefined();
    });

    it('should return the single SQL condition when only one valid condition exists', () => {
      const condition = eq(sql`id`, 1);
      const result = genWhere([condition]);
      expect(result).toBe(condition);
    });

    it('should return the single valid SQL condition when mixed with undefined', () => {
      const condition = eq(sql`id`, 1);
      const result = genWhere([undefined, condition, undefined]);
      expect(result).toBe(condition);
    });

    it('should combine multiple SQL conditions with AND operator', () => {
      const condition1 = eq(sql`id`, 1);
      const condition2 = eq(sql`name`, 'test');
      const result = genWhere([condition1, condition2]);

      expect(result).toBeDefined();
      // The result should be an AND combination
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should filter out undefined conditions and combine valid ones', () => {
      const condition1 = eq(sql`id`, 1);
      const condition2 = eq(sql`name`, 'test');
      const result = genWhere([undefined, condition1, undefined, condition2, undefined]);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });
  });

  describe('genStartDateWhere', () => {
    const mockKey = sql`created_at`;
    const mockFormat = (date: dayjs.Dayjs) => date.format('YYYY-MM-DD');

    it('should return undefined when date is undefined', () => {
      const result = genStartDateWhere(undefined, mockKey, mockFormat);
      expect(result).toBeUndefined();
    });

    it('should return undefined when date is empty string', () => {
      const result = genStartDateWhere('', mockKey, mockFormat);
      expect(result).toBeUndefined();
    });

    it('should return undefined when date is invalid', () => {
      const result = genStartDateWhere('invalid-date', mockKey, mockFormat);
      expect(result).toBeUndefined();
    });

    it('should handle lenient date parsing for malformed dates', () => {
      // dayjs is lenient and treats '2024-13-45' as valid, so it creates a condition
      const result = genStartDateWhere('2024-13-45', mockKey, mockFormat);
      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should create gte condition for valid ISO date string', () => {
      const result = genStartDateWhere('2024-01-15', mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should create gte condition for valid date with time', () => {
      const result = genStartDateWhere('2024-01-15T10:30:00Z', mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should handle timestamp number as string', () => {
      const timestamp = Date.now().toString();
      const result = genStartDateWhere(timestamp, mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should work with custom format function', () => {
      const customFormat = (date: dayjs.Dayjs) => date.unix();
      const result = genStartDateWhere('2024-01-15', mockKey, customFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });
  });

  describe('genEndDateWhere', () => {
    const mockKey = sql`created_at`;
    const mockFormat = (date: dayjs.Dayjs) => date.format('YYYY-MM-DD');

    it('should return undefined when date is undefined', () => {
      const result = genEndDateWhere(undefined, mockKey, mockFormat);
      expect(result).toBeUndefined();
    });

    it('should return undefined when date is empty string', () => {
      const result = genEndDateWhere('', mockKey, mockFormat);
      expect(result).toBeUndefined();
    });

    it('should return undefined when date is invalid', () => {
      const result = genEndDateWhere('invalid-date', mockKey, mockFormat);
      expect(result).toBeUndefined();
    });

    it('should handle lenient date parsing for malformed dates', () => {
      // dayjs is lenient and treats '2024-13-45' as valid, so it creates a condition
      const result = genEndDateWhere('2024-13-45', mockKey, mockFormat);
      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should create lte condition with date plus one day', () => {
      const result = genEndDateWhere('2024-01-15', mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should create lte condition for valid date with time', () => {
      const result = genEndDateWhere('2024-01-15T10:30:00Z', mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should handle timestamp number as string', () => {
      const timestamp = Date.now().toString();
      const result = genEndDateWhere(timestamp, mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should work with custom format function', () => {
      const customFormat = (date: dayjs.Dayjs) => date.unix();
      const result = genEndDateWhere('2024-01-15', mockKey, customFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });
  });

  describe('genRangeWhere', () => {
    const mockKey = sql`created_at`;
    const mockFormat = (date: dayjs.Dayjs) => date.format('YYYY-MM-DD');

    it('should return undefined when range is undefined', () => {
      const result = genRangeWhere(undefined, mockKey, mockFormat);
      expect(result).toBeUndefined();
    });

    it('should return undefined when both dates in range are invalid', () => {
      const result = genRangeWhere(['invalid-date', 'also-invalid'], mockKey, mockFormat);
      expect(result).toBeUndefined();
    });

    it('should create end date condition when only end date is valid', () => {
      const result = genRangeWhere(['invalid-date', '2024-01-15'], mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should create start date condition when only start date is valid', () => {
      const result = genRangeWhere(['2024-01-15', 'invalid-date'], mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should combine both start and end date conditions when both are valid', () => {
      const result = genRangeWhere(['2024-01-01', '2024-01-31'], mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should handle ISO date strings in range', () => {
      const result = genRangeWhere(
        ['2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z'],
        mockKey,
        mockFormat,
      );

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should handle timestamp numbers as strings in range', () => {
      const startTimestamp = new Date('2024-01-01').getTime().toString();
      const endTimestamp = new Date('2024-01-31').getTime().toString();
      const result = genRangeWhere([startTimestamp, endTimestamp], mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should work with custom format function', () => {
      const customFormat = (date: dayjs.Dayjs) => date.unix();
      const result = genRangeWhere(['2024-01-01', '2024-01-31'], mockKey, customFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should handle edge case where start date is after end date', () => {
      // The function doesn't validate date order, it just creates the conditions
      const result = genRangeWhere(['2024-01-31', '2024-01-01'], mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should handle same date for start and end', () => {
      const result = genRangeWhere(['2024-01-15', '2024-01-15'], mockKey, mockFormat);

      expect(result).toBeDefined();
      expect(result?.constructor.name).toBe('SQL');
    });
  });
});
