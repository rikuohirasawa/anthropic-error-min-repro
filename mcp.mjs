#!/usr/bin/env node
/**
 * Minimal MCP Server for Testing Large Responses
 *
 *
 * To run: node mcp.mjs
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { TOOL_RESPONSE_SIZE } from './utils.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const app = express();
const PORT = process.env.PORT || 3031;

// Parse JSON bodies
app.use(express.json());

// Log ALL incoming requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.ip}`);
    console.log(`  Headers:`, JSON.stringify(req.headers, null, 2));
    next();
});

// CORS for Anthropic
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
    res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
        console.log(`[${new Date().toISOString()}] Responding to OPTIONS preflight`);
        res.sendStatus(200);
        return;
    }

    next();
});

const createServer = async () => {
    const server = new McpServer(
        {
            name: 'minimal-test-mcp',
            version: '1.0.0',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );
    
    console.log('Registering multiple tools...');
    
    // Tool 1: get-profile (simulates get-lp-profile)
    server.registerTool(
        'get-profile',
        {
            description: 'Get a profile with structured data',
        },
        async () => {
            console.log(`[${new Date().toISOString()}] Tool called: get-profile`);
            await sleep(800); // Short delay to maximize request throughput
    
            const profile = JSON.stringify({
                uuid: 'abc-123',
                name: 'Test LP',
                type: 'Pension Fund',
                aum: { amount: 1000000000, currency: 'USD' },
                sectors: ['Tech', 'Healthcare'],
            });
    
            return {
                content: [{ type: 'text', text: profile }],
            };
        }
    );
    
    // Tool 2: query-database (simulates query-discovery-database)
    server.registerTool(
        'query-database',
        {
            description: 'Run a database query and return results',
        },
        async () => {
            console.log(`[${new Date().toISOString()}] Tool called: query-database`);
            await sleep(1200); // Slightly longer to create variety in timing
    
            const results = JSON.stringify([
                { id: 1, name: 'Row 1', value: 100 },
                { id: 2, name: 'Row 2', value: 200 },
                { id: 3, name: 'Row 3', value: 300 },
            ]);
    
            return {
                content: [{ type: 'text', text: results }],
            };
        }
    );
    
    // Tool 3: enrich-data (simulates enrich-lp-profile)
    server.registerTool(
        'enrich-data',
        {
            description: 'Enrich a profile with additional data',
        },
        async () => {
            console.log(`[${new Date().toISOString()}] Tool called: enrich-data`);
            await sleep(500); // Very short delay
    
            return {
                content: [{ type: 'text', text: 'Successfully enriched profile with new data' }],
            };
        }
    );
    
    console.log('All tools registered successfully');

    return server;
}

// Create MCP server


// MCP endpoint
app.post('/mcp', async (req, res) => {
    console.log(
        `[${new Date().toISOString()}] Received MCP request:`,
        req.body?.method || 'unknown method',
        JSON.stringify(req.body, null, 2)
    );

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });

    res.on('close', async () => {
        console.log(`[${new Date().toISOString()}] Response closed`);
        try {
            await transport.close();
        } catch (error) {
            console.error('Error closing transport:', error);
        }
    });

    try {
        console.log(`[${new Date().toISOString()}] Connecting server to transport...`);
        const server = await createServer();
        await server.connect(transport);
        console.log(`[${new Date().toISOString()}] Server connected, handling request...`);
        await transport.handleRequest(req, res, req.body);
        console.log(`[${new Date().toISOString()}] MCP request handled successfully`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error handling MCP request:`, error);
        console.error('Stack:', error.stack);
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
