#!/usr/bin/env node
/**
 * Minimal MCP Server for Testing Large Responses
 *
 *
 * To run: node mcp.mjs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { TOOL_RESPONSE_SIZE } from './utils.mjs';

const app = express();
const PORT = process.env.PORT || 3031;

// Parse JSON bodies
app.use(express.json());

// CORS for Anthropic
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
    res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }

    next();
});

// Create MCP server
const server = new Server(
    {
        name: 'minimal-test-mcp',
        version: '1.0.0',
        title: 'Minimal Test MCP',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'get-data',
                description: 'Returns data (large response)',
                inputSchema: {
                    type: 'object',
                },
            },
        ],
    };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    console.log(`[${new Date().toISOString()}] Tool called: ${request.params.name}`);

    try {
        console.log(
            `[${new Date().toISOString()}] Generating ${Math.round(TOOL_RESPONSE_SIZE / 1024)}KB response...`
        );

        // Generate data to match the target size
        const largeData = 'x'.repeat(TOOL_RESPONSE_SIZE);

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(largeData),
                },
            ],
        };
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error handling tool call:`, error);
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});

// MCP endpoint
app.post('/mcp', async (req, res) => {
    console.log(
        `[${new Date().toISOString()}] Received MCP request:`,
        req.body?.method || 'unknown method'
    );

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });

    res.on('close', async () => {
        try {
            await transport.close();
        } catch (error) {
            console.error('Error closing transport:', error);
        }
    });

    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        console.log(`[${new Date().toISOString()}] MCP request handled successfully`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error handling MCP request:`, error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error',
                },
                id: null,
            });
        }
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log('');
    console.log('='.repeat(70));
    console.log('🚀 Minimal MCP Server Started');
    console.log('='.repeat(70));
    console.log('');
    console.log(`Port:           ${PORT}`);
    console.log(`MCP Endpoint:   http://localhost:${PORT}/mcp`);
    console.log('');
    console.log('Press Ctrl+C to stop');
    console.log('='.repeat(70));
    console.log('');
}).on('error', (error) => {
    console.error('Error starting server:', error);
    process.exit(1);
});
