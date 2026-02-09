/**
 * Gemini Service
 * 
 * Main interface for the 2nd Brain AI assistant.
 * Uses the multi-agent system with soul, memory, and tools.
 */

import { 
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from "@google/genai";
import Constants from "expo-constants";
import {
  initializeBrain,
  reinitializeBrain,
  connectMCP,
  getBrainState,
  getSoul,
  chat,
  type AgentContext,
  type AgentResponse,
  type AgentSoul,
  type ToolCall,
  type AgentEventCallback,
} from "./agents";
import { checkMCPHealth } from "./mcp-client";

// =============================================================================
// CONFIGURATION
// =============================================================================

const API_KEY =
  Constants.expoConfig?.extra?.geminiKey ||
  process.env.GEMINIKEY ||
  process.env.EXPO_PUBLIC_GEMINIKEY ||
  process.env.GEMINI_API_KEY ||
  process.env.EXPO_PUBLIC_GEMINI_API_KEY ||
  (typeof window !== "undefined" && (window as any).__GEMINIKEY__);

if (!API_KEY) {
  console.error("❌ GEMINIKEY not found in environment variables");
}

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : new GoogleGenAI({});
const MODEL_NAME = "gemini-3-flash-preview";

// =============================================================================
// TYPES
// =============================================================================

export interface ChatMessage {
  id: string;
  text: string;
  role: "user" | "assistant";
  timestamp: number;
  toolCalls?: ToolCall[];
  thinking?: string;
  metadata?: {
    model?: string;
    agentName?: string;
    skillsUsed?: string[];
    memoriesAccessed?: number;
    latencyMs?: number;
    groundingMetadata?: any;
    citations?: any[];
    thoughts?: any;
  };
}

export interface BrainStatus {
  initialized: boolean;
  soul: AgentSoul | null;
  mcpConnected: boolean;
  memoryConnected: boolean;
}

// Re-export types
export type { ToolCall, AgentSoul, AgentEventCallback };

// =============================================================================
// BRAIN INITIALIZATION
// =============================================================================

let brainInitPromise: Promise<BrainStatus> | null = null;
let lastAuthState: boolean = false; // Track if last init was authenticated

/**
 * Initialize 2nd Brain agent system
 * 
 * Handles auth state changes: if the previous initialization was unauthenticated
 * and now we have a JWT token, it will reinitialize to connect memory.
 */
export async function initializeBrainAgent(jwtToken?: string): Promise<BrainStatus> {
  const isAuthenticated = !!jwtToken;
  
  // Reinitialize if:
  // 1. No cached promise exists, OR
  // 2. Auth state changed from unauthenticated to authenticated
  const shouldReinitialize = !brainInitPromise || (!lastAuthState && isAuthenticated);
  
  if (shouldReinitialize) {
    lastAuthState = isAuthenticated;
    brainInitPromise = initializeBrain(jwtToken).then(result => ({
      initialized: result.success,
      soul: result.soul,
      mcpConnected: result.mcpConnected,
      memoryConnected: result.memoryConnected,
    }));
  }
  
  return brainInitPromise;
}

/**
 * Get current brain status
 */
export function getBrainStatus(): BrainStatus {
  const state = getBrainState();
  return {
    initialized: state.initialized,
    soul: state.soul,
    mcpConnected: state.mcpConnected,
    memoryConnected: state.memoryConnected,
  };
}

/**
 * Get the agent's soul/identity
 */
export function getAgentSoul(): AgentSoul | null {
  return getSoul();
}

/**
 * Reinitialize brain (for reconnecting services)
 */
export async function reinitializeBrainAgent(jwtToken?: string): Promise<BrainStatus> {
  lastAuthState = !!jwtToken; // Update auth state tracker
  brainInitPromise = null; // Clear cached promise
  brainInitPromise = reinitializeBrain(jwtToken).then(result => ({
    initialized: result.success,
    soul: result.soul,
    mcpConnected: result.mcpConnected,
    memoryConnected: result.memoryConnected,
  }));
  return brainInitPromise;
}

/**
 * Connect MCP only (without full reinitialization)
 */
export async function connectMCPService(): Promise<boolean> {
  return connectMCP();
}

// =============================================================================
// CHAT FUNCTIONS
// =============================================================================

/**
 * Send a chat message to 2nd Brain
 * 
 * This is the main entry point for all chat interactions.
 * Uses the soulful multi-agent system with memory and tools.
 */
export async function sendChatMessage(
  message: string,
  chatHistory: ChatMessage[] = [],
  options: {
    jwtToken?: string;
    sessionId?: string;
    onEvent?: AgentEventCallback;
  } = {}
): Promise<{ text: string; metadata: any; toolCalls?: ToolCall[]; thinking?: string }> {
  const { jwtToken, sessionId = `session-${Date.now()}`, onEvent } = options;

  try {
    // Build agent context from chat history
    const context: AgentContext = {
      sessionId,
      userId: "user", // Will be extracted from JWT in production
      jwtToken,
      workspaceAuthenticated: getBrainState().mcpConnected,
      conversationHistory: chatHistory.map(msg => ({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.text,
        timestamp: msg.timestamp,
      })),
    };

    // Call the brain
    const response = await chat(message, context, onEvent);

    // Build metadata
    const metadata = {
      model: MODEL_NAME,
      agentName: response.agentName,
      skillsUsed: response.metadata.skillsUsed,
      memoriesAccessed: response.metadata.memoriesAccessed,
      latencyMs: response.metadata.latencyMs,
      groundingMetadata: response.metadata.groundingMetadata,
      citations: response.metadata.citations,
    };

    return {
      text: response.text,
      metadata,
      toolCalls: response.toolCalls,
      thinking: response.thinking,
    };
  } catch (error: any) {
    console.error("Error in sendChatMessage:", error);
    throw new Error(error.message || "Failed to get response from 2nd Brain");
  }
}

/**
 * Legacy compatibility - get MCP status
 */
export async function initializeMCP(): Promise<boolean> {
  const health = await checkMCPHealth();
  return health.healthy;
}

export function getMCPStatus(): { connected: boolean; toolCount: number } {
  const state = getBrainState();
  return {
    connected: state.mcpConnected,
    toolCount: state.mcpTools.length,
  };
}

// =============================================================================
// AUDIO FUNCTIONS
// =============================================================================

/**
 * Transcribe audio using Gemini Files API
 */
export async function transcribeAudio(
  audioFilePath: string,
  mimeType: string = "audio/mp4"
): Promise<string> {
  try {
    let fileToUpload: any;
    
    if (audioFilePath.startsWith("file://")) {
      const response = await fetch(audioFilePath);
      if (!response.ok) {
        throw new Error(`Failed to read file: ${response.statusText}`);
      }
      const blob = await response.blob();
      const extension = mimeType === "audio/mp4" ? "m4a" : mimeType.split('/')[1] || 'audio';
      const fileName = `recording.${extension}`;
      fileToUpload = new File([blob], fileName, { type: mimeType });
    } else {
      fileToUpload = audioFilePath;
    }

    const uploadedFile = await ai.files.upload({
      file: fileToUpload,
      config: { mimeType },
    });

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: createUserContent([
        createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
        "Transcribe this audio to text. Return only the transcribed text without any additional commentary.",
      ]),
    });

    const text = response.text || "";
    
    // Clean up
    try {
      await ai.files.delete({ name: uploadedFile.name });
    } catch (e) {
      // Ignore cleanup errors
    }

    return text;
  } catch (error: any) {
    console.error("Error transcribing audio:", error);
    throw new Error(error.message || "Failed to transcribe audio");
  }
}

/**
 * Send audio message with transcription
 */
export async function sendAudioMessage(
  audioFilePath: string,
  chatHistory: ChatMessage[] = [],
  mimeType: string = "audio/mp4",
  options: { jwtToken?: string; sessionId?: string } = {}
): Promise<{ transcription: string; response: string; metadata: any }> {
  const transcription = await transcribeAudio(audioFilePath, mimeType);
  const { text: response, metadata } = await sendChatMessage(transcription, chatHistory, options);

  return {
    transcription,
    response,
    metadata,
  };
}
