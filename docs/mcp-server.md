# MCP server

Cascade exposes a **stateless Streamable HTTP MCP server** at `POST /mcp`. It is intended for MCP clients that can send JSON-RPC over HTTP and attach an API key header.

## Authentication

Create an API key in **Admin → API keys** and choose a scope:

- `read` — read tools only
- `write` — workspace reads and writes, no admin pages
- `full` — owner behavior (including admin access when the key owner is an admin)

Send the key with either header:

```http
x-api-key: csk_...
```

or:

```http
Authorization: Bearer csk_...
```

Never put the key in a URL. The endpoint returns `401` for a missing, invalid, or revoked key. It uses the same owner/admin checks as the rest of Cascade; a key can never enumerate or read another account's private workspace. Read-only keys are denied mutation tools before any database write.

## Protocol

The endpoint supports:

- `initialize` (protocol version `2025-03-26`, `2025-06-18`, or `2025-11-25`)
- `ping`
- `notifications/initialized`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`

Every JSON-RPC message is a POST. Responses are ordinary `application/json`; no `Mcp-Session-Id` is issued and there is no server-initiated SSE stream. A GET returns `405`, and malformed JSON returns `400` with JSON-RPC error `-32700`.

## Tools

| Tool | Scope | Purpose |
|---|---|---|
| `whoami` | read | Authenticated user and scope; no key material |
| `list_documents` | read | Owner-scoped list of workspace documents |
| `get_document` | read | Read an owned/admin-visible document and its JSON |
| `list_versions` | read | List the last 25 snapshots |
| `get_version` | read | Read a specific snapshot |
| `create_document` | write | Create a doc, sheet, deck, PDF, board, form, or code file |
| `update_document` | write | Replace editor JSON with optimistic version checking |

Resources are available at `cascade://documents/:id` for clients that support MCP resources.

## Quick check

```bash
KEY=csk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
URL=http://localhost:3000/mcp

curl -s "$URL" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'

curl -s "$URL" \
  -H "x-api-key: $KEY" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

A write key can create a document with:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "create_document",
    "arguments": {
      "kind": "doc",
      "name": "MCP note",
      "content": { "html": "<h1>Created through MCP</h1>" }
    }
  }
}
```

Use `get_document` before `update_document`, and pass the returned `version` for conflict detection.

## Boundaries

- The endpoint has no stdio transport; use the URL above from a remote-capable MCP client.
- It is stateless, so clients should not depend on `Mcp-Session-Id`, GET event streams, or server-initiated messages.
- The 2026-07-28 no-handshake/discovery flow has not been validated with a real client. The 2025 initialization flow and direct JSON-RPC calls are covered by the real-HTTP regression test.
- API keys are shown in plaintext only once at creation; they are stored as SHA-256 hashes and are never included in MCP tool output or logs.
