/**
 * Source of the Code Mode worker, evaluated with `new Worker(source, { eval: true })`.
 *
 * Kept as a plain string, not a function's `toString()`: the server is bundled
 * and test runs instrument code, and either could rewrite a function body into
 * something that no longer runs on its own inside a worker.
 *
 * Isolation, from the outside in:
 * - The worker runs with an empty `env`, so the script's thread never holds
 *   the server's secrets; the parent terminates it on timeout, and V8 resource
 *   limits cap its heap.
 * - The script itself runs in a separate `vm` context whose global is an
 *   ordinary in-context object (`DONT_CONTEXTIFY`), with code generation from
 *   strings disabled. No host object is ever placed in that context — a host
 *   function there would hand the script the host realm's `Function`, and
 *   with it `process` and `require`.
 * - So the bridge is message passing over primitives only: the script queues
 *   JSON strings in an in-context outbox, the worker drains it by polling and
 *   answers by calling an in-context function with string arguments.
 */
export const CODE_MODE_WORKER_SOURCE = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');

const { code, toolNames, maxLogChars, syncTimeoutMs } = workerData;

const post = (message) => parentPort.postMessage(message);

const fail = (code, message) => {
  post({ outcome: { error: { code, message }, logs: [], ok: false }, type: 'done' });
};

const stripTypes = (source) => {
  let strip;
  try {
    strip = require('node:module').stripTypeScriptTypes;
  } catch {
    strip = undefined;
  }
  if (typeof strip !== 'function') return source;

  // The builtin stripper is still flagged experimental and warns once per
  // process; the warning carries nothing for the script's author.
  const emitWarning = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return strip(source, { mode: 'strip' });
  } finally {
    process.emitWarning = emitWarning;
  }
};

const PRELUDE = '(' + function prelude(toolNamesJson, maxLogChars) {
  const outbox = [];
  const pending = new Map();
  const logs = [];
  let logChars = 0;
  let logsTruncated = false;
  let seq = 0;
  let outcome = '';

  const format = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.name + ': ' + value.message;
    try {
      const json = JSON.stringify(value);
      return json === undefined ? String(value) : json;
    } catch {
      return String(value);
    }
  };

  const log = (...args) => {
    const line = args.map(format).join(' ');
    if (logChars + line.length > maxLogChars) {
      logsTruncated = true;
      return;
    }
    logChars += line.length + 1;
    logs.push(line);
  };

  const callTool = (name, args) => {
    if (typeof name !== 'string') {
      return Promise.reject(
        new TypeError('callTool(name, args): name must be a string like "identifier.toolName"'),
      );
    }
    let argsJson;
    try {
      argsJson = JSON.stringify(args === undefined ? {} : args);
    } catch (error) {
      return Promise.reject(
        new TypeError('Arguments of "' + name + '" are not JSON-serializable: ' + error.message),
      );
    }
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { reject, resolve });
      outbox.push(JSON.stringify({ args: argsJson, id, name, type: 'call' }));
    });
  };

  const tools = {};
  for (const fullName of JSON.parse(toolNamesJson)) {
    const dot = fullName.indexOf('.');
    const identifier = fullName.slice(0, dot);
    const apiName = fullName.slice(dot + 1);
    if (!tools[identifier]) tools[identifier] = {};
    tools[identifier][apiName] = (args) => callTool(fullName, args);
  }

  const define = (key, value) =>
    Object.defineProperty(globalThis, key, { configurable: false, value, writable: false });

  define('console', { debug: log, error: log, info: log, log, warn: log });
  define('callTool', callTool);
  define('tools', tools);

  define('__codeModeDrain', () => {
    if (outbox.length === 0) return '';
    const drained = JSON.stringify(outbox);
    outbox.length = 0;
    return drained;
  });

  define('__codeModeDeliver', (id, ok, payload) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok) {
      entry.resolve(payload === '' ? undefined : JSON.parse(payload));
      return;
    }
    const detail = JSON.parse(payload);
    const error = new Error(detail.message);
    error.code = detail.code;
    error.tool = detail.tool;
    entry.reject(error);
  });

  define('__codeModeOutcome', () => outcome);

  define('__codeModeRun', (main) => {
    const settle = (value) => {
      outcome = JSON.stringify({ logs, logsTruncated, ...value });
    };
    Promise.resolve()
      .then(() => main())
      .then(
        (value) => {
          let json;
          try {
            json = value === undefined ? '' : JSON.stringify(value);
          } catch (error) {
            settle({
              error: {
                code: 'RESULT_NOT_SERIALIZABLE',
                message: 'The returned value is not JSON-serializable: ' + error.message,
              },
              ok: false,
            });
            return;
          }
          settle({ ok: true, value: json === undefined ? '' : json });
        },
        (error) => {
          const isError = error instanceof Error;
          settle({
            error: {
              code: (isError && typeof error.code === 'string' && error.code) || 'SCRIPT_ERROR',
              message: isError ? error.name + ': ' + error.message : format(error),
              stack: isError && typeof error.stack === 'string' ? error.stack : undefined,
              tool: isError && typeof error.tool === 'string' ? error.tool : undefined,
            },
            ok: false,
          });
        },
      );
  });
} + ')';

const start = () => {
let context;
let main;
try {
  const isolatedGlobal =
    vm.constants && vm.constants.DONT_CONTEXTIFY !== undefined
      ? vm.constants.DONT_CONTEXTIFY
      : Object.create(null);
  context = vm.createContext(isolatedGlobal, {
    codeGeneration: { strings: false, wasm: false },
    name: 'lobe-code-mode',
  });
  vm.runInContext(PRELUDE, context)(JSON.stringify(toolNames), maxLogChars);
} catch (error) {
  fail('SANDBOX_INIT_FAILED', String(error && error.message ? error.message : error));
  return;
}

try {
  const source = stripTypes('(async () => {\n' + code + '\n})');
  main = vm.runInContext(source, context, { filename: 'script.ts', timeout: syncTimeoutMs });
} catch (error) {
  const message = error && error.message ? String(error.message) : String(error);
  fail('SCRIPT_SYNTAX_ERROR', message);
  return;
}

parentPort.on('message', (message) => {
  if (message && message.type === 'result') {
    context.__codeModeDeliver(message.id, message.ok, message.payload);
  }
});

context.__codeModeRun(main);

const timer = setInterval(() => {
  const drained = context.__codeModeDrain();
  if (drained) {
    for (const raw of JSON.parse(drained)) post(JSON.parse(raw));
  }
  const outcome = context.__codeModeOutcome();
  if (outcome) {
    clearInterval(timer);
    post({ outcome: JSON.parse(outcome), type: 'done' });
  }
}, 2);
};

start();
`;
