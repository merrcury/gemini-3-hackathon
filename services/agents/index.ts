/**
 * 2nd Brain Agent System
 *
 * A multi-agent system with soul, memory, and integrated tools.
 * Inspired by OpenClaw: identity (soul), workspace via MCP, memory, and grounding.
 *
 * Features:
 * - Soul/Identity: personality, values, user context (OpenClaw-style)
 * - Long-term memory via Mem0 (add/search, soul persistence, preference learning)
 * - Google Workspace via MCP (tools from server; minimal client aliases)
 * - Web search with Google Search grounding (source priority over memory)
 * - Deep reasoning with Gemini thinking mode; retry with fallback model
 */

// Core brain
export {
    DEFAULT_SOUL, chat,
    connectMCP, getBrainState,
    getSoul,
    initializeBrain,
    reinitializeBrain,
    resetBrainState
} from "./brain";
// Memory
export {
    addMemory,
    checkMemoryHealth,
    getAllMemories,
    getMemoryApiUrl,
    getRelevantMemories,
    loadSoul,
    saveSoul,
    searchMemory,
    storeConversationMemory,
    updateSoul
} from "./memory";
// Soul & Identity
export {
    addUserInterest,
    evolveSoul,
    generateIdentityStatement,
    generateSystemPrompt,
    toggleSkill
} from "./soul";

// Types
export type {
    AgentContext,
    AgentEvent,
    AgentEventCallback,
    AgentEventType,
    AgentResponse,
    AgentSkill,
    AgentSoul,
    ConversationMessage,
    ToolCall
} from "./types";

