# @uah/server

**UAH Server** — a framework for building high-performance server applications on Node.js with a custom TypeScript compiler that analyzes source code and generates an optimized runtime based on decorators and types.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Requirements](#requirements)
- [Tech Stack](#tech-stack)
- [Compiler](#compiler)
- [Runtime](#runtime)
  - [HTTP Server](#http-server)
  - [WebSocket RPC](#websocket-rpc)
  - [Contexts](#contexts)
  - [PostgreSQL Integration](#postgresql-integration)
  - [Models and Patch System](#models-and-patch-system)
  - [Authentication (JWT)](#authentication-jwt)
  - [Authorization (Permission)](#authorization-permission)
  - [WebAuthn](#webauthn)
  - [Caching](#caching)
  - [Task Scheduler](#task-scheduler)
  - [Migrations](#migrations)
  - [Testing](#testing)
  - [File Serving](#file-serving)
- [Type System and Validation](#type-system-and-validation)
- [Exceptions](#exceptions)
- [Process Management](#process-management)

---

## Architecture Overview

UAH Server is not a traditional configure-via-code framework. It is a **compiling framework**: you write TypeScript classes with decorators (`@Server`, `@Postgres`, `@Table`, `@SessionJWT`, `@Access`), and the built-in compiler — powered by the TypeScript Compiler API — analyzes types, decorators, and code structure to generate optimized JavaScript that includes automatic input validation, routing, response serialization, and SQL migrations.

```
┌─────────────────────────────────────────────────────────┐
│  Source Code (TypeScript with decorators)                │
│  src/app/ — API routes, models, services                │
│  src/lib/ — reusable modules                            │
└───────────────────────┬─────────────────────────────────┘
                        │  TypeScript Compiler API
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Compiler (@uah/server/src/compiler/)                   │
│  - Decorator and type analysis                          │
│  - Validator generation from types                      │
│  - HTTP/WS handler generation                           │
│  - SQL migration generation from @Table                 │
│  - Test runner generation                               │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  build/ — generated JavaScript                          │
│  Runtime (@uah/server/src/runtime/)                     │
│  - uWebSockets.js (HTTP + WebSocket)                    │
│  - @uah/postgres (PostgreSQL)                           │
│  - JWT sessions, Permission, WebAuthn                   │
│  - Scheduler, migrations, tests                         │
└─────────────────────────────────────────────────────────┘
```

---

## Requirements

- **Node.js** ≥ 25.0.0
- **PostgreSQL** (via `@uah/postgres`)

## Tech Stack

| Component | Technology |
|-----------|-----------|
| HTTP/WebSocket server | [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js) v20.56.0 |
| Database | PostgreSQL via [@uah/postgres](https://github.com/uasan/postgres) |
| Compiler | TypeScript Compiler API (typescript ^5.9.3) |
| Linter/formatter | [Biome](https://biomejs.dev/) |
| Module system | ESM (`"type": "module"`) |

---

## Compiler

The core of the framework is a custom compiler built on top of the TypeScript Compiler API. It does not simply transpile TypeScript to JavaScript — it **analyzes types and decorators** to generate optimized runtime code.

### How Compilation Works

1. **Project parsing** — `ts.createWatchProgram` / `ts.createSemanticDiagnosticsBuilderProgram` reads `tsconfig.json` and builds the dependency graph.

2. **File classification** — `factoryEntity` determines each file's type by path:
   - `src/app/**` → API routes (`AppRouteEntity`)
   - Files with `TableModel` → models (`ModelEntity`)
   - Migration files → `MigrationEntity`
   - Files with `SchedulerContext` → schedulers
   - Test files → `TestEntity`

3. **AST transformation** — `visitor.js` traverses the AST and applies maker functions for each node type: classes, decorators, methods, imports, enums. TypeScript-specific nodes (types, interfaces, `as`, `satisfies`) are removed.

4. **Code generation from decorators**:
   - `@Server` → creates HTTP/WS server, registers routes
   - `@Postgres` → connects PostgreSQL to the context
   - `@Table` → registers model, generates table metadata
   - `@SessionJWT` → injects `auth`, `createSession`, `deleteSession` methods
   - `@Access` → wraps the method with permission checking

5. **Automatic validation** — the compiler reads method parameter types and generates runtime validators. For example, a parameter of type `{ name: Text<{ maxLength: 100 }>, age: Int<{ min: 0 }> }` is automatically validated before the method is called.

6. **Route generation**:
   - `get(payload)` → HTTP GET, parameters from query string
   - `post(payload)` → HTTP POST, parameters from body
   - `put`, `patch`, `delete` → corresponding HTTP methods
   - `onOpen(payload)` → WebSocket upgrade

### Watch Mode

In dev mode, the compiler runs in watch mode, launches a worker thread with `build/bin/server.js`, and automatically rebuilds on changes. The worker is restarted via `parentPort.postMessage` → graceful shutdown.

---

## Runtime

### HTTP Server

The server is built on **uWebSockets.js** — one of the fastest HTTP/WebSocket servers for Node.js (written in C++).

The `Server` class wraps `uWebSockets.App()`, manages the lifecycle (start/stop/destroy), and integrates with the graceful shutdown system via `AbortController`.

The `Router` registers routes with path parameter support and handles both HTTP and WebSocket endpoints.

**Supported HTTP methods:** GET, HEAD, PUT, POST, PATCH, DELETE.

**Response formats:**
- JSON (`respondJson`) — wrapper `{ data: ... }`, Content-Type: `application/json`
- Binary (`respondBinary`) — raw binary data
- File (`respondFile`) — file streaming with Range request support
- NoContent — 204

### WebSocket RPC

WebSocket RPC implements a JSON-based RPC protocol over WebSocket:

**Client message format:**
```json
{ "method": "methodName", "params": { ... }, "id": "optional-request-id" }
```

**Response format:**
```json
{ "id": "request-id", "result": { ... } }
```

**Error format:**
```json
{ "id": "request-id", "error": { "status": 500, "type": "Error", "message": "..." } }
```

If `id` is omitted, the method operates as fire-and-forget.

**Features:**
- Connection tracking by `sid` (socket ID) and `uid` (user ID)
- Send message to a specific socket: `sendMessageToSocket(sid, payload)`
- Send message to a user (all their sockets): `sendMessageToUser(uid, payload)`
- Pub/Sub channels: `sendMessageToChannel(name, payload)`, `subscribe(name)`, `unsubscribe(name)`
- Automatic pings (idleTimeout: 30 seconds)
- Compression (SHARED_COMPRESSOR)
- Maximum message size: 16 MB
- Duplicate socket ID protection (Conflict 409)

### Contexts

Contexts are the central abstraction of the framework. Each request creates a context instance.

**`Context`** (base) — provides:
- `sql` — tagged template literal for SQL queries via `@uah/postgres`
- `startTransaction(action, payload)` — transaction with automatic `BEGIN`/`COMMIT`/`ROLLBACK`
- `static mock(preset)` — mock creation for testing

**`ServerContext`** (extends Context) — adds:
- `request` — cookies, headers (etag, range)
- `response` — status, headers, setCookie, deleteCookie
- `user`, `session`, `permission`, `socket`
- `auth()` — authentication (abstract, implemented via `@SessionJWT`)
- `createSession(user)` / `deleteSession()`
- `subscribeToChannel(name)` / `unsubscribeFromChannel(name)`
- `sendMessageToSocket(payload)`
- `isConnected` — connection activity flag

Static methods for server-side pushes:
- `static sendMessageToUser(uid, payload)`
- `static sendMessageToSocket(sid, payload)`
- `static sendMessageToChannel(name, payload)`

### PostgreSQL Integration

Integration via `@uah/postgres` — a custom PostgreSQL driver.

**The `@Postgres` decorator** connects a context to the database:
```typescript
@Postgres({
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  username: 'user',
  password: 'pass',
  maxConnections: 10,
})
```

SQL queries are executed via tagged template literals:
```typescript
const users = await ctx.sql`SELECT * FROM users WHERE id = ${userId}`;
```

### Models and Patch System

**The `@Table` decorator** defines a model bound to a PostgreSQL table:
```typescript
@Table({
  name: 'users',
  primary: ['id'],
  unique: { email: ['email'] },
  references: {
    org: { keys: { org_id: Organization }, onDelete: 'cascade' },
  },
})
```

**`TableModel`** — the base model class with automatic `created_at` and `updated_at` fields.

**Patch system** — declarative CRUD via JSON patches:
```json
{
  "patch": {
    "add": [{ "name": "John", "email": "john@example.com" }],
    "set": [{ "id": 1, "name": "Jane" }],
    "delete": [{ "id": 2 }]
  }
}
```

Patch processes `add` (INSERT), `set` (UPDATE), `delete` (DELETE) operations and automatically resolves related models (relations) recursively.

### Authentication (JWT)

The `@SessionJWT` decorator adds JWT authentication via cookies:

```typescript
@SessionJWT({
  secret: 'my-secret-key',
  maxAge: 86400,               // Session TTL in seconds
  algorithm: 'HS256',           // HS256 | HS384 | HS512
  cookies: {
    uid: { name: 'UID', httpOnly: false, sameSite: 'Lax' },
    jwt: { name: 'JWT', httpOnly: true, sameSite: 'Lax' },
  },
})
```

The session is stored in two cookies: `UID` (user ID, accessible from JS) and `JWT` (token, httpOnly). During authentication, the signature, expiration, and user ID match are verified.

### Authorization (Permission)

Rule-based permission system:

```typescript
const canRead = new Permission({
  rules: [isAdmin, isOwner],
});

const canWrite = new Permission({
  parent: canRead,           // inherits parent checks
  rules: [isEditor],
});
```

A rule is a function `(context, payload) => boolean | Promise<boolean>`. Rules are checked sequentially; the first one that passes wins.

The `@Access(permission)` decorator on an API method automatically calls `auth()` and checks permissions before executing the method.

### WebAuthn

Built-in FIDO2/WebAuthn support for passwordless authentication:

- Supported algorithms: Ed25519 (EDDSA -8), ES256 (-7), PS256 (-37), RS256 (-257)
- `WebAuthn.create(options)` — registration (challenge validation)
- `WebAuthn.get(options)` — authentication (signature verification via Web Crypto API)

### Caching

The `Cache` class provides HTTP caching utilities:

| Method | Description |
|--------|-------------|
| `Cache.setImmutable(ctx)` | `Cache-Control: max-age=31536000, immutable`, `ETag: 1` |
| `Cache.checkImmutable(req, res)` | Checks `If-None-Match`, returns 304 |
| `Cache.setAge(ctx, age)` | `Cache-Control: max-age={age}`, ETag based on timestamp |
| `Cache.checkAge(req, res)` | Checks freshness by ETag-timestamp |
| `Cache.setNoStore(ctx)` | `Cache-Control: no-store` |

### Task Scheduler

`SchedulerContext` — the base class for periodic background tasks:

```typescript
class MyTask extends SchedulerContext {
  interval = '5 minutes';     // PostgreSQL interval format
  priority = 10;              // Execution priority (higher = earlier)

  async init() { /* one-time initialization */ }
  async start() { /* runs every interval */ }
  async stop() { /* cleanup on shutdown */ }
}
```

Tasks with the same interval are grouped into a single timer. Timers are aligned to the interval (`time - (now % time)`), ensuring predictable scheduling. The scheduler automatically stops on graceful shutdown.

### Migrations

Database migration system:

```bash
UAH.migrate              # Apply migrations (up)
UAH.migrate status       # Show migration status
UAH.migrate up [version] # Apply up to a specific version
```

The compiler generates SQL migrations based on `@Table` decorators and models. Migrations run within transactions, and state is stored in the database.

### Testing

Built-in test framework with transactional isolation:

- `TestRunner` runs each test inside a PostgreSQL transaction
- Automatic `ROLLBACK` after each test (no data persists)
- Nested test support (tree structure)
- Test skipping (`skipped`)
- Test payloads are passed between related tests via `results`
- Console reporter with pass/fail/skip statuses

### File Serving

`respondFile` — high-performance file streaming:

- HTTP Range request support (partial downloads, video streaming)
- File descriptors are cached in memory
- Non-blocking reads via `fs.read` with a 128 KB buffer
- Backpressure via `tryEnd` / `onWritable`
- Headers: `Accept-Ranges`, `Content-Range`, `Content-Type`, `Content-Disposition`, `Last-Modified`

---

## Type System and Validation

The compiler generates runtime validators from TypeScript types. Special branded types from `@uah/server` define validation rules:

### Strings

| Type | Description |
|------|-------------|
| `Text<{ maxLength?, minLength?, trim?, pattern?, lowercase?, uppercase? }>` | String with constraints |
| `Email` | Email address |
| `UUID` | UUID format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) |

### Numbers

| Type | Description |
|------|-------------|
| `Int<{ min?, max? }>` | Integer |
| `Int8`, `Int16`, `Int32` | Bit-width constrained integers |
| `Uint8`, `Uint16`, `Uint32` | Unsigned integers |
| `Float<{ min?, max? }>`, `Float32` | Floating-point numbers |
| `IntSerial` | Auto-increment (serial) |
| `BigIntSerial` | BigInt auto-increment |

### Binary Data

| Type | Description |
|------|-------------|
| `Bytes<{ length?, minLength?, maxLength? }>` | `Uint8Array` |
| `ArrayBuffer<{ byteLength?, minByteLength?, maxByteLength? }>` | ArrayBuffer |
| `DataView` | DataView |
| `TypedArray` | Any typed array |
| `BinaryData` | Union: ArrayBuffer, TypedArray, DataView, Blob, File |
| `Blob` | Blob |
| `File` | File |

### Other

| Type | Description |
|------|-------------|
| `DateLike` | Date |
| `Default<T>` | Default value |

---

## Exceptions

HTTP exception hierarchy inheriting from `Exception` (extends `Error`):

| Class | HTTP Status | Description |
|-------|-------------|-------------|
| `Exception` | 500 | Base server exception |
| `BadRequest` | 400 | Malformed request |
| `Unauthorized` | 401 | Not authenticated |
| `Forbidden` | 403 | Access denied |
| `NotFound` | 404 | Resource not found |
| `NotAllowed` | 405 | Method not allowed |
| `Conflict` | 409 | Conflict (e.g., duplicate) |
| `LengthRequired` | 411 | Content-Length required |
| `ContentTooLarge` | 413 | Request body too large |
| `RangeNotSatisfiable` | 416 | Invalid Range header |
| `UnProcessable` | 422 | Invalid data |
| `Timeout` | 504 | Timeout |
| `Unavailable` | 503 | Service unavailable |

Errors with status 500 log the stack trace to `console.error`. All other errors are returned to the client.

---

## Process Management

The framework ensures **graceful shutdown** on any termination:

- Signal handling: `SIGINT`, `SIGTERM`, `SIGQUIT`, `SIGHUP`, `SIGTSTP`, `SIGUSR1`, `SIGUSR2`
- Exception handling: `uncaughtException`, `unhandledRejection`, `beforeExit`
- Single coordination point: `AbortController.signal` — all components (server, scheduler, WebSocket) subscribe to abort
- Worker thread support: in child threads, shutdown is triggered via `parentPort.message`
