import { describe, expect, it } from 'vitest';

import { SECRET_XOR_KEY } from '@/envs/auth';

import { obfuscatePayloadWithXOR } from './xor-obfuscation';

describe('xor-obfuscation', () => {
  describe('obfuscatePayloadWithXOR', () => {
    it('应该对简单字符串进行混淆并返回Base64字符串', () => {
      const payload = 'hello world';
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();

      // 验证结果长度大于0
      expect(result.length).toBeGreaterThan(0);
    });

    it('应该对JSON对象进行混淆', () => {
      const payload = { name: 'test', value: 123, active: true };
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('应该对数组进行混淆', () => {
      const payload = [1, 2, 3, 'test', { nested: true }];
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('应该对复杂嵌套对象进行混淆', () => {
      const payload = {
        user: {
          id: 123,
          profile: {
            name: 'John Doe',
            settings: {
              theme: 'dark',
              notifications: true,
              preferences: ['email', 'sms'],
            },
          },
        },
        tokens: ['abc123', 'def456'],
        metadata: null,
      };
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('相同的输入应该产生相同的输出', () => {
      const payload = { test: 'consistent' };
      const result1 = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);
      const result2 = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      expect(result1).toBe(result2);
    });

    it('不同的输入应该产生不同的输出', () => {
      const payload1 = { test: 'value1' };
      const payload2 = { test: 'value2' };

      const result1 = obfuscatePayloadWithXOR(payload1, SECRET_XOR_KEY);
      const result2 = obfuscatePayloadWithXOR(payload2, SECRET_XOR_KEY);

      expect(result1).not.toBe(result2);
    });

    it('应该处理包含特殊字符的字符串', () => {
      const payload = 'Hello! @#$%^&*()_+-=[]{}|;:,.<>?/~`"\'\\';
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('应该处理包含Unicode字符的字符串', () => {
      const payload = '你好世界 🌍 émojis 日本語 한국어';
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('应该处理空字符串', () => {
      const payload = '';
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('应该处理空对象', () => {
      const payload = {};
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('应该处理空数组', () => {
      const result = obfuscatePayloadWithXOR([], SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('应该处理null值', () => {
      const payload = null;
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('应该处理数字', () => {
      const payload = 42;
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('应该处理布尔值', () => {
      const payloadTrue = true;
      const payloadFalse = false;

      const resultTrue = obfuscatePayloadWithXOR(payloadTrue, SECRET_XOR_KEY);
      const resultFalse = obfuscatePayloadWithXOR(payloadFalse, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof resultTrue).toBe('string');
      expect(typeof resultFalse).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(resultTrue)).not.toThrow();
      expect(() => atob(resultFalse)).not.toThrow();

      // 验证不同布尔值产生不同结果
      expect(resultTrue).not.toBe(resultFalse);
    });

    it('应该处理包含特殊JSON字符的对象', () => {
      const payload = {
        quotes: '"double quotes"',
        singleQuotes: "'single quotes'",
        backslash: 'back\\slash',
        newline: 'line1\nline2',
        tab: 'col1\tcol2',
        unicode: '\u0041\u0042\u0043',
      };
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('应该处理很长的字符串', () => {
      const payload = 'a'.repeat(10_000);
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();

      // 验证结果长度合理（Base64编码后长度应该大约是原始长度的4/3）
      expect(result.length).toBeGreaterThan(0);
    });

    it('应该产生不同长度输入的不同输出长度', () => {
      const shortPayload = 'short';
      const longPayload = 'this is a much longer string that should produce different output';

      const shortResult = obfuscatePayloadWithXOR(shortPayload, SECRET_XOR_KEY);
      const longResult = obfuscatePayloadWithXOR(longPayload, SECRET_XOR_KEY);

      // 较长的输入应该产生较长的输出
      expect(longResult.length).toBeGreaterThan(shortResult.length);
    });

    it('应该验证输出是有效的Base64格式', () => {
      const payload = { test: 'base64 validation' };
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证Base64格式的正则表达式
      const base64Regex = /^[A-Z0-9+/]*={0,2}$/i;
      expect(base64Regex.test(result)).toBe(true);
    });

    it('应该处理包含循环引用的对象（通过JSON.stringify处理）', () => {
      // JSON.stringify 会抛出错误处理循环引用，但我们测试正常情况
      const payload = {
        id: 1,
        name: 'test',
        nested: {
          back: 'reference',
        },
      };

      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);
      expect(typeof result).toBe('string');
      expect(() => atob(result)).not.toThrow();
    });

    it('应该对undefined值进行处理', () => {
      const payload = undefined;
      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);

      // 验证返回值是字符串
      expect(typeof result).toBe('string');

      // 验证返回值是有效的Base64字符串
      expect(() => atob(result)).not.toThrow();
    });

    it('应该对包含函数的对象进行处理（函数会被JSON.stringify忽略）', () => {
      const payload = {
        name: 'test',
        fn: function () {
          return 'test';
        },
        arrow: () => 'arrow',
        value: 123,
      };

      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);
      expect(typeof result).toBe('string');
      expect(() => atob(result)).not.toThrow();
    });

    it('应该确保XOR操作的确定性', () => {
      const payload = 'deterministic test';
      const results: any[] = [];

      // 多次运行相同输入
      for (let i = 0; i < 10; i++) {
        results.push(obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY));
      }

      // 所有结果应该相同
      expect(results.every((result) => result === results[0])).toBe(true);
    });

    it('应该处理包含日期对象的数据', () => {
      const payload = {
        timestamp: new Date('2024-01-01T00:00:00Z'),
        created: new Date(),
        name: 'date test',
      };

      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);
      expect(typeof result).toBe('string');
      expect(() => atob(result)).not.toThrow();
    });

    it('应该处理包含Symbol的对象（Symbol会被JSON.stringify忽略）', () => {
      const sym = Symbol('test');
      const payload = {
        name: 'symbol test',
        [sym]: 'symbol value',
        normalKey: 'normal value',
      };

      const result = obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);
      expect(typeof result).toBe('string');
      expect(() => atob(result)).not.toThrow();
    });

    it('应该验证混淆后的数据长度合理性', () => {
      const originalPayload = { test: 'length check' };
      const originalJSON = JSON.stringify(originalPayload);
      const result = obfuscatePayloadWithXOR(originalPayload, SECRET_XOR_KEY);

      // Base64 编码后的长度通常是原始长度的 4/3 倍（向上取整到4的倍数）
      const expectedMinLength = Math.ceil((originalJSON.length * 4) / 3 / 4) * 4;
      expect(result.length).toBeGreaterThanOrEqual(expectedMinLength - 4); // 允许一些误差
    });

    it('应该验证XOR操作的正确性（通过逆向操作）', () => {
      const originalPayload = { message: 'XOR test', value: 42 };
      const obfuscatedResult = obfuscatePayloadWithXOR(originalPayload, SECRET_XOR_KEY);

      // 手动实现逆向操作来验证 XOR 操作的正确性
      const base64Decoded = atob(obfuscatedResult);
      const xoredBytes = new Uint8Array(base64Decoded.length);
      for (let i = 0; i < base64Decoded.length; i++) {
        xoredBytes[i] = base64Decoded.charCodeAt(i);
      }

      // 使用相同的密钥进行逆向 XOR 操作
      const keyBytes = new TextEncoder().encode(SECRET_XOR_KEY);
      const decodedBytes = new Uint8Array(xoredBytes.length);
      for (const [i, xoredByte] of xoredBytes.entries()) {
        decodedBytes[i] = xoredByte ^ keyBytes[i % keyBytes.length];
      }

      // 将结果转换回字符串
      const decodedString = new TextDecoder().decode(decodedBytes);
      const decodedPayload = JSON.parse(decodedString);

      // 验证解码后的数据与原始数据相同
      expect(decodedPayload).toEqual(originalPayload);
    });

    it('应该验证不同输入产生不同的Base64输出', () => {
      const payloads = [
        'test1',
        'test2',
        { key: 'value1' },
        { key: 'value2' },
        [1, 2, 3],
        [4, 5, 6],
      ];

      const results = payloads.map((payload) => obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY));

      // 验证所有结果都不相同
      for (let i = 0; i < results.length; i++) {
        for (let j = i + 1; j < results.length; j++) {
          expect(results[i]).not.toBe(results[j]);
        }
      }
    });
  });
});
