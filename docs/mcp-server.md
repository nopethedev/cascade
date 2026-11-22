# MCP server

Cascade exposes a **stateless Streamable HTTP MCP server** at `POST /mcp`. It is intended for MCP clients that can send JSON-RPC over HTTP and attach an API key header. It has been exercised end to end with the official `@modelcontextprotocol/sdk` `1.32.2` `StreamableHTTPClientTransport`; see `test/mcp-sdk.test.mjs`.

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

### Why this stateless shape is spec-permitted

This behavior was checked against the **MCP 2025-11-25** specification, [Transports → Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports):

- **Session Management, item 1:** a server **MAY** assign a session id. Cascade chooses not to, so there is nothing to put in `Mcp-Session-Id`.
- **Listening for Messages from the Server, item 3:** a server **MUST** either return a `text/event-stream` for GET or return **405 Method Not Allowed**. Cascade returns 405 because it offers no GET stream.
- **Session Management, item 5:** DELETE is a client **SHOULD**; a server **MAY** return 405 when it does not allow session termination. Cascade returns 405 because it has no session to terminate.
- **Sending Messages to the Server, item 5:** a POST request may receive either `text/event-stream` or one `application/json` response. Cascade returns JSON, and the official SDK accepts it.

`MCP-Protocol-Version` headers are validated against the three advertised revisions. A missing header is accepted (the specification says to assume `2025-03-26`); an invalid or unsupported header receives **400** with JSON-RPC `-32600`.

For the id-oracle requirement, `resources/read` and `get_document` return no document id, URI, or record-derived detail in a not-found response. Foreign-owner ids and nonexistent ids therefore have identical caller-visible errors.

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
- It is stateless, so clients should not depend on `Mcp-Session-Id`, GET event streams, or server-initiated messages. This is permitted by MCP 2025-11-25 Streamable HTTP (see above), not an accidental omission.
- The 2026-07-28 no-handshake/discovery flow has not been validated with a real client. The 2025 initialization flow and direct JSON-RPC calls are covered by the real-HTTP regression test.
- API keys are shown in plaintext only once at creation; they are stored as SHA-256 hashes and are never included in MCP tool output or logs.
