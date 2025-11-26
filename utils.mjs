
/* 
 * Size of the response to return from the MCP tool
 * For race condition testing, keep this small (the delay matters more than size)
 * For large response testing, increase to 2000 * 1024 or more
 */
export const TOOL_RESPONSE_SIZE = 1000; // 1KB - small for fast race condition testing