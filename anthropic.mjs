#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk';

// Configuration - adjust these for your setup
const CONFIG = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    mcpUrl: process.env.MCP_URL,
    maxTokens: 2048,
    sizeKb: 400, // Size of response to request
    // Run test N times to measure reproducibility
    iterations: 5,
};

console.log('=== MCP LARGE RESPONSE TEST ===\n');
console.log(`Testing MCP with single tool call returning...`);
console.log(`MCP URL: ${CONFIG.mcpUrl}`);
console.log(`Iterations: ${CONFIG.iterations}\n`);

async function testLargeResponse(iteration) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`TEST #${iteration}: MCP single call response)`);
    console.log('='.repeat(70));

    if (!CONFIG.anthropicApiKey) {
        console.error('❌ ERROR: ANTHROPIC_API_KEY not set');
        process.exit(1);
    }

    const client = new Anthropic({
        apiKey: CONFIG.anthropicApiKey,
    });
    const startTime = Date.now();

    // Event tracking
    const events = {
        connect: false,
        thinking: false,
        text: false,
        mcp_tool_use: false,
        mcp_tool_result: false,
        message_stop: false,
        stream_error: null,
        abort: false,
        completed: false,
    };

    try {
        const stream = client.beta.messages.stream(
            {
                model: 'claude-haiku-4-5-20251001',
                stream: true,
                max_tokens: CONFIG.maxTokens,
                thinking: {
                    type: 'enabled',
                    budget_tokens: 1024,
                },
                system: [
                    {
                        type: 'text',
                        text: 'You are testing MCP tool responses. Call get-data to retrieve the test data. After it completes, say "Data received" and stop.',
                    },
                ],
                messages: [
                    {
                        role: 'user',
                        content: `Call the get-data tool to retrieve the test data. After it completes, say "Data received" and stop. Do not make any other tool calls.`,
                    },
                ],
                mcp_servers: [
                    {
                        type: 'url',
                        url: `${CONFIG.mcpUrl}/mcp`,
                        name: 'Test MCP',
                        tool_configuration: {
                            allowed_tools: ['get-data'],
                        },
                    },
                ],
            },
            {
                headers: {
                    'anthropic-beta': ['mcp-client-2025-04-04', 'interleaved-thinking-2025-05-14'],
                },
            }
        );

        // Track events
        stream.on('connect', () => {
            events.connect = true;
            console.log(`[${Date.now() - startTime}ms] ✅ Connected`);
        });

        stream.on('contentBlock', (block) => {
            const elapsed = Date.now() - startTime;

            switch (block.type) {
                case 'mcp_tool_use':
                    events.mcp_tool_use = true;
                    console.log(`[${elapsed}ms] 🔧 mcp_tool_use: ${block.name}`);
                    break;

                case 'mcp_tool_result':
                    events.mcp_tool_result = true;
                    const size = JSON.stringify(block).length;
                    console.log(`[${elapsed}ms] 📦 mcp_tool_result received (${size} bytes)`);
                    break;

                case 'thinking':
                    events.thinking = true;
                    console.log(`[${elapsed}ms] 💭 thinking`);
                    break;

                case 'text':
                    events.text = true;
                    process.stdout.write('.');
                    break;
            }
        });

        stream.on('error', (streamError) => {
            events.stream_error = streamError;
            console.log(`\n[${Date.now() - startTime}ms] ❌ Stream error event:`);
            console.log('   Message:', streamError.message);
            console.log('   Type:', streamError.constructor.name);
        });

        stream.on('abort', (abortError) => {
            events.abort = true;
            console.log(`\n[${Date.now() - startTime}ms] ⚠️ Stream abort event`);
            if (abortError) {
                console.log('   Message:', abortError.message);
            }
        });

        stream.on('end', () => {
            events.completed = true;
            console.log(`\n[${Date.now() - startTime}ms] ✅ Stream end event`);
        });

        // This is where it typically fails for large responses
        await stream.done();
        console.log(`[${Date.now() - startTime}ms] ✅ stream.done()`);

        const finalMessage = await stream.finalMessage();
        const duration = Date.now() - startTime;

        console.log(`[${duration}ms] ✅ stream.finalMessage()\n`);

        // Results
        console.log('RESULTS:');
        console.log(`  Duration: ${duration}ms`);
        console.log(`  Connected: ${events.connect ? '✅' : '❌'}`);
        console.log(`  mcp_tool_use detected: ${events.mcp_tool_use ? '✅' : '❌'}`);
        console.log(`  mcp_tool_result received: ${events.mcp_tool_result ? '✅' : '❌'}`);
        console.log(`  thinking detected: ${events.thinking ? '✅' : '❌'}`);
        console.log(`  text detected: ${events.text ? '✅' : '❌'}`);
        console.log(`  stream_error event: ${events.stream_error ? '❌ YES' : '✅ NO'}`);
        console.log(`  abort event: ${events.abort ? '⚠️ YES' : '✅ NO'}`);
        console.log(`  completed event: ${events.completed ? '✅' : '❌'}`);
        console.log(`  Final message content blocks: ${finalMessage.content.length}`);
        console.log(`  Stop reason: ${finalMessage.stop_reason}`);

        const success = events.mcp_tool_result && !events.stream_error && !events.abort;

        console.log(`\nVERDICT: ${success ? '✅ SUCCESS' : '❌ FAILURE'}`);

        return {
            success,
            duration,
            events,
        };
    } catch (error) {
        const duration = Date.now() - startTime;

        console.log(`\n[${duration}ms] ❌ Exception thrown\n`);

        // Log full error details
        console.log('=== ERROR DETAILS ===');
        console.log('Error Type:', error.constructor.name);
        console.log('Error Message:', error.message);

        if (error.stack) {
            console.log('\nStack Trace:');
            console.log(error.stack.split('\n').slice(0, 5).join('\n'));
        }

        console.log('\n=== EVENT SUMMARY ===');
        console.log(`  Connected: ${events.connect ? '✅' : '❌'}`);
        console.log(`  mcp_tool_use detected: ${events.mcp_tool_use ? '✅' : '❌'}`);
        console.log(`  mcp_tool_result received: ${events.mcp_tool_result ? '✅' : '❌'}`);
        console.log(`  thinking detected: ${events.thinking ? '✅' : '❌'}`);
        console.log(`  text detected: ${events.text ? '✅' : '❌'}`);
        console.log(`  stream_error event: ${events.stream_error ? '❌ YES' : '✅ NO'}`);
        console.log(`  abort event: ${events.abort ? '⚠️ YES' : '✅ NO'}`);
        console.log(`  completed event: ${events.completed ? '✅' : '❌'}`);

        console.log('\n=== KEY OBSERVATION ===');
        if (
            events.mcp_tool_use &&
            !events.mcp_tool_result &&
            !events.stream_error &&
            !events.abort
        ) {
            console.log(
                '🎯 BUG CONFIRMED: Tool was called but result never arrived, no error/abort events!'
            );
            console.log('   This matches the SDK bug from the GitHub issue.');
        } else if (events.completed && !events.stream_error && !events.abort) {
            console.log(
                '🎯 BUG CONFIRMED: Stream said it completed but finalMessage() threw exception!'
            );
            console.log('   No error/abort events were fired.');
        }

        console.log(`\nVERDICT: ❌ FAILURE`);
        console.log('  - Stream ended with exception');
        console.log('  - SDK recognized stream as incomplete');

        return {
            success: false,
            duration,
            events,
            error: error.message,
        };
    }
}

// Run multiple iterations
async function runTests() {
    console.log('Running tests...\n');

    const results = [];

    for (let i = 1; i <= CONFIG.iterations; i++) {
        const result = await testLargeResponse(i);
        results.push(result);

        // Wait 2 seconds between tests
        if (i < CONFIG.iterations) {
            console.log('\nWaiting 2 seconds before next test...\n');
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    // Summary
    console.log('\n\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

    console.log(`\nTotal tests: ${CONFIG.iterations}`);
    console.log(
        `Successes: ${successCount} (${Math.round((successCount / CONFIG.iterations) * 100)}%)`
    );
    console.log(
        `Failures: ${failureCount} (${Math.round((failureCount / CONFIG.iterations) * 100)}%)`
    );
    console.log(`Average duration: ${Math.round(avgDuration)}ms`);

    console.log('\nResults by iteration:');
    results.forEach((result, i) => {
        console.log(
            `  #${i + 1}: ${result.success ? '✅ SUCCESS' : '❌ FAILURE'} (${result.duration}ms)${result.error ? ` - ${result.error}` : ''}`
        );
    });

    console.log('\n' + '='.repeat(70));
    console.log('CONCLUSION');
    console.log('='.repeat(70));

    if (failureCount === 0) {
        console.log(`
✅ ALL TESTS PASSED

The cumulative MCP response did not trigger the bug in ${CONFIG.iterations} attempts.
This is surprising given the size far exceeds the 400KB web_fetch threshold.
This could mean:
- The bug was fixed
- The bug is highly intermittent and needs many more iterations
- Server-side factors affect reproducibility
- Different timing/conditions needed to trigger it

Note: Your production logs showed this happens intermittently.
`);
    } else if (failureCount === CONFIG.iterations) {
        console.log(`
🎯 BUG CONSISTENTLY REPRODUCED

All ${CONFIG.iterations} tests failed with cumulative MCP responses.
This confirms the bug is consistently triggered by very large cumulative MCP responses.

The pattern matches the GitHub issue #846:
- Stream receives data but stops emitting events  
- No error/abort events are fired
- finalMessage() throws generic exception
`);
    } else {
        console.log(`
⚠️ BUG INTERMITTENTLY REPRODUCED

Failed ${failureCount}/${CONFIG.iterations} times (${Math.round((failureCount / CONFIG.iterations) * 100)}% failure rate).


This matches your production experience where enrichment sometimes works, sometimes fails.
`);
    }

    console.log('='.repeat(70) + '\n');

    // Exit with appropriate code
    process.exit(failureCount > 0 ? 1 : 0);
}

// Run
runTests().catch((error) => {
    console.error('\nFatal error:', error);
    process.exit(1);
});
