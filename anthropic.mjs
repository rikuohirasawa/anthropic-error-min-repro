#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk';

// Configuration - adjust these for your setup
const CONFIG = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    mcpUrl: process.env.MCP_URL,
    maxTokens: 4096,
    // Number of CONCURRENT streams (simulates multiple enrichment workflows running at once)
    concurrentStreams: 30,
    // Number of tool calls EACH stream makes (simulates one workflow calling multiple tools)
    toolCallsPerStream: 5,
    // Run the test N times to measure reproducibility
    iterations: 3,
};

console.log('=== MCP CONCURRENT + SEQUENTIAL TEST ===\n');
console.log(`Testing concurrent streams, each making multiple sequential tool calls`);
console.log(`This mirrors production: multiple enrichment workflows running simultaneously,`);
console.log(`each workflow making multiple tool calls to the shared MCP server.`);
console.log(`\nMCP URL: ${CONFIG.mcpUrl}`);
console.log(`Concurrent streams: ${CONFIG.concurrentStreams}`);
console.log(`Tool calls per stream: ${CONFIG.toolCallsPerStream}`);
console.log(`Iterations: ${CONFIG.iterations}\n`);

async function testSingleStream(streamId, startDelay = 0) {
    // Stagger stream starts so they call different tools at the same time
    if (startDelay > 0) {
        console.log(`[Stream ${streamId}] Waiting ${startDelay}ms before starting...`);
        await new Promise((resolve) => setTimeout(resolve, startDelay));
    }
    
    console.log(`\n[Stream ${streamId}] Starting...`);

    const client = new Anthropic({
        apiKey: CONFIG.anthropicApiKey,
    });
    const startTime = Date.now();

    try {
        console.log(`[Stream ${streamId}][${Date.now() - startTime}ms] 🔄 Sending request...`);
        
        const message = await client.beta.messages.create(
            {
                model: 'claude-haiku-4-5-20251001',
                max_tokens: CONFIG.maxTokens,
                // thinking: {
                //     type: 'enabled',
                //     budget_tokens: 1024,
                // },
                system: [
                    {
                        type: 'text',
                        text: `You are testing MCP tools. You have access to: get-profile, query-database, and enrich-data. Call them in a purely random order. They do not actually represent real tools, but are used to test the MCP server. Ignore the tool names entirely!!!! Make exactly ${CONFIG.toolCallsPerStream} total calls. After each tool returns, briefly acknowledge and call the next tool.`,
                    },
                ],
                messages: [
                    {
                        role: 'user',
                        content: `Call the tools ${CONFIG.toolCallsPerStream} times total in this order: get-profile → query-database → enrich-data. Repeat the cycle if you need more calls. Start now with get-profile.`,
                    },
                ],
                mcp_servers: [
                    {
                        type: 'url',
                        url: `${CONFIG.mcpUrl}/mcp`,
                        name: 'Test MCP',
                        tool_configuration: {
                            allowed_tools: ['get-profile', 'query-database', 'enrich-data'],
                        },
                    },
                ],
            },
            {
                headers: {
                    'anthropic-beta': ['mcp-client-2025-04-04'],
                },
            }
        );

        const duration = Date.now() - startTime;
        console.log(`[Stream ${streamId}][${duration}ms] ✅ Response received`);

        // Count tool uses and results from the message content
        let mcp_tool_use_count = 0;
        let mcp_tool_result_count = 0;

        for (const block of message.content) {
            switch (block.type) {
                case 'mcp_tool_use':
                    mcp_tool_use_count++;
                    console.log(`[Stream ${streamId}][${duration}ms] 🔧 mcp_tool_use #${mcp_tool_use_count}: ${block.name}`);
                    break;
                case 'mcp_tool_result':
                    mcp_tool_result_count++;
                    const size = JSON.stringify(block).length;
                    console.log(`[Stream ${streamId}][${duration}ms] 📦 mcp_tool_result #${mcp_tool_result_count} received (${size} bytes)`);
                    break;
                case 'text':
                    // Don't log text to reduce noise
                    break;
                case 'thinking':
                    // Don't log thinking to reduce noise
                    break;
            }
        }

        // Success if we got all the tool results back
        const success =
            mcp_tool_use_count === CONFIG.toolCallsPerStream &&
            mcp_tool_result_count === CONFIG.toolCallsPerStream;

        const verdict = success ? '✅ SUCCESS' : '❌ FAILURE';
        console.log(`[Stream ${streamId}] ${verdict} - ${mcp_tool_result_count}/${CONFIG.toolCallsPerStream} tool results (${duration}ms)\n`);

        return {
            streamId,
            success,
            duration,
            stopReason: message.stop_reason,
            toolCallsMade: mcp_tool_use_count,
            toolResultsReceived: mcp_tool_result_count,
        };
    } catch (error) {
        const duration = Date.now() - startTime;

        console.log(`[Stream ${streamId}][${duration}ms] ❌ Exception: ${error.message}`);
        console.log(`[Stream ${streamId}] ❌ FAILURE\n`);

        return {
            streamId,
            success: false,
            duration,
            error: error.message,
            toolCallsMade: 0,
            toolResultsReceived: 0,
        };
    }
}

async function testConcurrentStreams(iteration) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(
        `ITERATION #${iteration}: ${CONFIG.concurrentStreams} concurrent streams, ${CONFIG.toolCallsPerStream} calls each`
    );
    console.log('='.repeat(70));

    if (!CONFIG.anthropicApiKey) {
        console.error('❌ ERROR: ANTHROPIC_API_KEY not set');
        process.exit(1);
    }

    if (!CONFIG.mcpUrl) {
        console.error('❌ ERROR: MCP_URL not set');
        process.exit(1);
    }

    console.log(
        `\nFiring ${CONFIG.concurrentStreams} concurrent streams ALL AT ONCE...`
    );
    console.log(`Each stream will call tools in random order`);
    console.log(`All streams start simultaneously = MAXIMUM race condition potential`);
    console.log(
        `This hammers the shared MCP server with ${CONFIG.concurrentStreams} concurrent requests!\n`
    );

    const startTime = Date.now();

    // Launch streams with NO STAGGER - all at once!
    // With random tool ordering, this creates maximum concurrent load
    // All 10 streams will start simultaneously and race on the shared server
    const streamPromises = Array.from({ length: CONFIG.concurrentStreams }, (_, i) =>
        testSingleStream(i + 1, 0) // All start at 0ms = maximum contention!
    );

    const results = await Promise.all(streamPromises);
    const totalDuration = Date.now() - startTime;

    // Analyze results
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    console.log('='.repeat(70));
    console.log(`ITERATION #${iteration} RESULTS:`);
    console.log('='.repeat(70));
    console.log(`Total duration: ${totalDuration}ms`);
    console.log(`Successful streams: ${successCount}/${CONFIG.concurrentStreams}`);
    console.log(`Failed streams: ${failureCount}/${CONFIG.concurrentStreams}\n`);

    results.forEach((result) => {
        const icon = result.success ? '✅' : '❌';
        console.log(
            `  Stream ${result.streamId}: ${icon} ${result.toolResultsReceived}/${CONFIG.toolCallsPerStream} results${result.error ? ` - ${result.error}` : ''}`
        );
    });

    return {
        iteration,
        successCount,
        failureCount,
        totalDuration,
        results,
    };
}


// Run multiple iterations
async function runTests() {
    console.log('Running concurrent + sequential test...\n');

    const allResults = [];

    for (let i = 1; i <= CONFIG.iterations; i++) {
        const result = await testConcurrentStreams(i);
        allResults.push(result);

        // Wait 3 seconds between iterations
        if (i < CONFIG.iterations) {
            console.log('\n⏳ Waiting 3 seconds before next iteration...\n');
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
    }

    // Overall Summary
    console.log('\n\n' + '='.repeat(70));
    console.log('OVERALL SUMMARY');
    console.log('='.repeat(70));

    const totalStreams = CONFIG.iterations * CONFIG.concurrentStreams;
    const totalSuccesses = allResults.reduce((sum, r) => sum + r.successCount, 0);
    const totalFailures = allResults.reduce((sum, r) => sum + r.failureCount, 0);

    console.log(`\nTotal iterations: ${CONFIG.iterations}`);
    console.log(`Concurrent streams per iteration: ${CONFIG.concurrentStreams}`);
    console.log(`Tool calls per stream: ${CONFIG.toolCallsPerStream}`);
    console.log(`Total streams tested: ${totalStreams}`);
    console.log(
        `Successes: ${totalSuccesses}/${totalStreams} (${Math.round((totalSuccesses / totalStreams) * 100)}%)`
    );
    console.log(
        `Failures: ${totalFailures}/${totalStreams} (${Math.round((totalFailures / totalStreams) * 100)}%)`
    );

    console.log('\nResults by iteration:');
    allResults.forEach((result) => {
        const rate = Math.round((result.successCount / CONFIG.concurrentStreams) * 100);
        console.log(
            `  Iteration ${result.iteration}: ${result.successCount}/${CONFIG.concurrentStreams} succeeded (${rate}%)`
        );
    });

    console.log('\n' + '='.repeat(70));
    console.log('CONCLUSION');
    console.log('='.repeat(70));

    if (totalFailures === 0) {
        console.log(`
✅ NO BUG DETECTED

All ${totalStreams} concurrent streams succeeded, each making ${CONFIG.toolCallsPerStream} sequential tool calls.

This suggests the MCP server properly handles:
- Concurrent streams from multiple clients
- Sequential tool calls within each stream
- Shared server instance with multiple transports

The production bug might be caused by:
- Higher concurrency levels (try increasing concurrentStreams)
- Longer tool execution times (try increasing delay in mcp.mjs)
- Specific tool combinations (not just get-data)
- Network/infrastructure issues specific to production
`);
    } else if (totalFailures === totalStreams) {
        console.log(`
🎯 BUG CONSISTENTLY REPRODUCED!

ALL ${totalStreams} streams failed across ${CONFIG.iterations} iterations!

This confirms a critical bug when:
- Multiple streams run concurrently
- Each stream makes multiple sequential tool calls
- All share the same MCP server instance

Pattern: Responses are misrouted between concurrent streams when the
shared server instance calls server.connect(transport) with different transports.

THE FIX: Create a new MCP server instance per request in mcp.mjs
`);
    } else {
        const failureRate = Math.round((totalFailures / totalStreams) * 100);
        console.log(`
⚠️ BUG INTERMITTENTLY REPRODUCED (${failureRate}% failure rate)

Failed ${totalFailures}/${totalStreams} streams across ${CONFIG.iterations} iterations.

This matches production! The race condition is timing-dependent:
- Some streams complete before others start → succeed
- Some streams overlap and race on shared server → fail

This proves the bug exists with:
- Concurrent streams hitting shared MCP server
- Multiple tool calls per stream
- Timing-dependent failures (just like production!)

THE FIX: Create a new MCP server instance per request instead of sharing one.
`);
    }

    console.log('='.repeat(70) + '\n');

    // Exit with appropriate code
    process.exit(totalFailures > 0 ? 1 : 0);
}

// Run
runTests().catch((error) => {
    console.error('\nFatal error:', error);
    process.exit(1);
});
