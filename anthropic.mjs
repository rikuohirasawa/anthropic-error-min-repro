#!/usr/bin/env node

// Configuration - adjust these for your setup
const CONFIG = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    mcpUrl: process.env.MCP_URL || 'https://vitameric-semiprotected-julianne.ngrok-free.dev',
    maxTokens: 2048,
    sizeKb: 400, // Size of response to request
    // Run test N times to measure reproducibility
    iterations: 5,
};

console.log('=== MCP LARGE RESPONSE TEST (RAW FETCH) ===\n');
console.log(`Testing MCP with single tool call returning...`);
console.log(`MCP URL: ${CONFIG.mcpUrl}`);
console.log(`Iterations: ${CONFIG.iterations}\n`);

// Parse Server-Sent Events (SSE) stream
async function parseSSEStream(response, onEvent, onError) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            
            // Keep the last incomplete line in the buffer
            buffer = lines.pop() || '';

            let currentEvent = null;
            let currentData = '';

            for (const line of lines) {
                if (line.startsWith('event: ')) {
                    currentEvent = line.slice(7).trim();
                } else if (line.startsWith('data: ')) {
                    currentData = line.slice(6);
                    
                    if (currentEvent && currentData) {
                        try {
                            const data = JSON.parse(currentData);
                            onEvent(currentEvent, data);
                        } catch (e) {
                            console.error('Failed to parse SSE data:', e);
                        }
                        currentEvent = null;
                        currentData = '';
                    }
                } else if (line === '') {
                    // Empty line separates events
                    currentEvent = null;
                    currentData = '';
                }
            }
        }
    } catch (error) {
        onError(error);
    }
}

async function testLargeResponse(iteration) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`TEST #${iteration}: MCP single call response)`);
    console.log('='.repeat(70));

    if (!CONFIG.anthropicApiKey) {
        console.error('❌ ERROR: ANTHROPIC_API_KEY not set');
        process.exit(1);
    }

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

    // Store the final message as we build it
    const finalMessage = {
        id: null,
        role: 'assistant',
        content: [],
        model: null,
        stop_reason: null,
        usage: null,
    };

    try {
        const requestBody = {
            model: 'claude-sonnet-4-5',
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
        };

        console.log(`[${Date.now() - startTime}ms] 📡 Making request to Anthropic API...`);

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CONFIG.anthropicApiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'mcp-client-2025-04-04,interleaved-thinking-2025-05-14',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            // Clone to read error body
            const errorClone = response.clone();
            const errorBody = await errorClone.text();
            console.log(`[${Date.now() - startTime}ms] ❌ HTTP Error Response:`, errorBody);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Clone the response to log it while still being able to stream it
        const responseClone = response.clone();
        
        // Read the cloned response as text for logging
        (async () => {
            try {
                const rawBody = await responseClone.text();
                console.log(`[${Date.now() - startTime}ms] 📄 Full response body received (${rawBody.length} bytes)`);
                console.log(` Raw body: ${rawBody}`);
                // Optional: uncomment to see full raw SSE stream
                // console.log('Raw SSE stream:', rawBody);
            } catch (e) {
                console.log(`[${Date.now() - startTime}ms] ⚠️ Could not log response body:`, e.message);
            }
        })();

        events.connect = true;
        console.log(`[${Date.now() - startTime}ms] ✅ Connected`);

        // Track current content block
        let currentBlockIndex = -1;

        await parseSSEStream(
            response,
            (eventType, data) => {
                const elapsed = Date.now() - startTime;

                switch (eventType) {
                    case 'message_start':
                        finalMessage.id = data.message.id;
                        finalMessage.model = data.message.model;
                        finalMessage.role = data.message.role;
                        finalMessage.usage = data.message.usage;
                        break;

                    case 'content_block_start':
                        currentBlockIndex = data.index;
                        finalMessage.content[data.index] = data.content_block;

                        const blockType = data.content_block.type;
                        
                        if (blockType === 'mcp_tool_use') {
                            events.mcp_tool_use = true;
                            console.log(`[${elapsed}ms] 🔧 mcp_tool_use: ${data.content_block.name}`);
                        } else if (blockType === 'mcp_tool_result') {
                            events.mcp_tool_result = true;
                            const size = JSON.stringify(data.content_block).length;
                            console.log(`[${elapsed}ms] 📦 mcp_tool_result received (${size} bytes)`);
                        } else if (blockType === 'thinking') {
                            events.thinking = true;
                            console.log(`[${elapsed}ms] 💭 thinking`);
                        } else if (blockType === 'text') {
                            events.text = true;
                        }
                        break;

                    case 'content_block_delta':
                        if (currentBlockIndex >= 0) {
                            const block = finalMessage.content[currentBlockIndex];
                            
                            if (data.delta.type === 'text_delta') {
                                block.text = (block.text || '') + data.delta.text;
                                process.stdout.write('.');
                            } else if (data.delta.type === 'thinking_delta') {
                                block.thinking = (block.thinking || '') + data.delta.thinking;
                            }
                        }
                        break;

                    case 'content_block_stop':
                        // Block completed
                        break;

                    case 'message_delta':
                        if (data.delta.stop_reason) {
                            finalMessage.stop_reason = data.delta.stop_reason;
                        }
                        if (data.usage) {
                            finalMessage.usage = { ...finalMessage.usage, ...data.usage };
                        }
                        break;

                    case 'message_stop':
                        events.message_stop = true;
                        events.completed = true;
                        console.log(`\n[${elapsed}ms] ✅ message_stop event`);
                        break;

                    case 'error':
                        events.stream_error = data;
                        console.log(`\n[${elapsed}ms] ❌ Error event:`);
                        console.log('   Message:', data.error?.message || 'Unknown error');
                        break;
                }
            },
            (error) => {
                events.stream_error = error;
                console.log(`\n[${Date.now() - startTime}ms] ❌ Stream error:`);
                console.log('   Message:', error.message);
            }
        );

        const duration = Date.now() - startTime;
        console.log(`[${duration}ms] ✅ Stream completed\n`);

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
        console.log(`  Stop reason: ${finalMessage.stop_reason || 'none'}`);

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
            console.log('   This indicates an API-level issue (not SDK bug).');
        } else if (events.completed && !events.stream_error && !events.abort) {
            console.log(
                '🎯 Stream completed without errors'
            );
        }

        console.log(`\nVERDICT: ❌ FAILURE`);
        console.log('  - Stream ended with exception');

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
✅ ALL TESTS PASSED (RAW FETCH API)

The MCP response completed successfully in ${CONFIG.iterations} attempts.
This indicates:
- The Anthropic API itself is handling the stream correctly
- The issue may be SDK-specific (if SDK tests fail but raw fetch succeeds)
- Or the timeout issue is being reproduced (check server logs for 2min timeout)
`);
    } else if (failureCount === CONFIG.iterations) {
        console.log(`
🎯 BUG CONSISTENTLY REPRODUCED (RAW FETCH API)

All ${CONFIG.iterations} tests failed using raw fetch API.
This confirms the issue is at the API level, not SDK-specific:
- Stream receives data but stops emitting events  
- No error/abort events are fired
- Stream ends with exception

This is an API-level timeout, likely the MCP tool call timeout (~2 minutes).
`);
    } else {
        console.log(`
⚠️ BUG INTERMITTENTLY REPRODUCED (RAW FETCH API)

Failed ${failureCount}/${CONFIG.iterations} times (${Math.round((failureCount / CONFIG.iterations) * 100)}% failure rate).

This confirms the issue exists at the API level and is intermittent.
This matches production behavior where MCP calls sometimes work, sometimes timeout.
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
