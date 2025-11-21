Reproduces a bug where `stream ended without producing a Message with role=assistant` error is thrown when MCP tool call result returns a large response.

The bug:

- Stream receives large MCP tool response
- Stream silently fails without error/abort events
- finalMessage() throws exception

To run:

1. `npm install`
2. `node mcp.js`
3. Set up a tunnel pointing at MCP server (e.g. ngrok)
4. `export ANTHROPIC_API_KEY=your-key`
5. `export MCP_URL=your-tunnel-url`
6. `node anthropic.mjs`

