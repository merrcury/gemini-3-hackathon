/**
 * Agent Types and Interfaces
 * 
 * Core type definitions for the 2nd Brain multi-agent system.
 */

// =============================================================================
// SOUL & IDENTITY
// =============================================================================

/**
 * The soul defines who the agent IS - its core identity and personality.
 * This gets created once and persisted in memory.
 */
export interface AgentSoul {
  // Core Identity
  name: string;
  version: string;
  createdAt: number;
  
  // Personality
  personality: {
    traits: string[];           // e.g., ["helpful", "curious", "proactive"]
    communicationStyle: string; // How the agent speaks
    tone: string;               // e.g., "warm and professional"
    quirks: string[];           // Unique behavioral traits
  };
  
  // Purpose & Values
  purpose: string;              // Why the agent exists
  coreValues: string[];         // What the agent believes in
  principles: string[];         // How the agent behaves
  
  // Capabilities & Boundaries
  skills: AgentSkill[];
  limitations: string[];        // What the agent won't do
  
  // User Context (personalized over time)
  userContext: {
    preferredName?: string;
    timezone?: string;
    location?: string;  // e.g. "Austin, TX" for SerpAPI and local context
    interests?: string[];
    workStyle?: string;
    communicationPreferences?: string[];
    aiCapabilities?: string[];
  };
}

/**
 * A skill the agent can perform
 */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  category: "workspace" | "research" | "memory" | "reasoning" | "communication";
  triggers: string[];           // Keywords/phrases that activate this skill
  enabled: boolean;
}

// =============================================================================
// AGENT CONTEXT & STATE
// =============================================================================

/**
 * Context for agent operations - passed through the agent chain
 */
export interface AgentContext {
  // Session
  sessionId: string;
  userId: string;
  
  // Authentication
  jwtToken?: string;
  workspaceAuthenticated: boolean;
  
  // Conversation
  conversationHistory: ConversationMessage[];
  
  // Memory
  relevantMemories?: string;
  
  // Soul (loaded from memory)
  soul?: AgentSoul;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  metadata?: {
    agentUsed?: string;
    toolsCalled?: string[];
    thinking?: string;
  };
}

// =============================================================================
// AGENT RESPONSES
// =============================================================================

export interface ToolCall {
  name: string;
  args: Record<string, any>;
  result?: string;
  status: "pending" | "success" | "error";
}

export interface AgentResponse {
  text: string;
  agentName: string;
  toolCalls: ToolCall[];
  thinking?: string;
  metadata: {
    model?: string;
    tokensUsed?: number;
    latencyMs?: number;
    skillsUsed?: string[];
    memoriesAccessed?: number;
    groundingMetadata?: any;
    citations?: any[];
    error?: string;
  };
}

// =============================================================================
// STREAMING & EVENTS
// =============================================================================

export type AgentEventType = 
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "agent_switch"
  | "memory_access"
  | "partial_response"
  | "complete";

export interface AgentEvent {
  type: AgentEventType;
  data: any;
  timestamp: number;
}

export type AgentEventCallback = (event: AgentEvent) => void;
