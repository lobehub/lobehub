---
name: debug-package
description: 'Use for debug() logging, lobe-* namespaces, DEBUG/localStorage.debug configuration and log formatting.'
user-invocable: false
---

# Debug Package Usage Guide

## Basic Usage

```typescript
import debug from 'debug';

// Format: lobe-[module]:[submodule]
const log = debug('lobe-server:market');

log('Simple message');
log('With variable: %O', object);
log('Formatted number: %d', number);
```

## Namespace Conventions

- Desktop: `lobe-desktop:[module]`
- Server: `lobe-server:[module]`
- Client: `lobe-client:[module]`
- Router: `lobe-[type]-router:[module]`

## Format Specifiers

- `%O` - Object expanded (recommended for complex objects)
- `%o` - Object
- `%s` - String
- `%d` - Number

## Enable Debug Output

### Browser

```javascript
localStorage.debug = 'lobe-*';
```

### Node.js

```bash
DEBUG=lobe-* npm run dev
DEBUG=lobe-* pnpm dev
```

### Electron

```typescript
process.env.DEBUG = 'lobe-*';
```

## Example

```typescript
// apps/server/src/routers/lambda/agentEval.ts
import debug from 'debug';

const log = debug('lobe-lambda-router:agent-eval');

log('getAgent input: %O', input);
```
