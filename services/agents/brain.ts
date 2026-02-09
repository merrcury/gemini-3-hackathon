/**
 * 2nd Brain - Core Agent
 * 
 * The main agent that coordinates all capabilities:
 * - Web search with Google Search grounding
 * - Google Workspace via MCP (Gmail, Drive, Calendar, Contacts)
 * - Long-term memory via Mem0
 * - Deep reasoning with thinking mode
 * 
 * This agent has a soul - personality, values, and skills that
 * make it feel like a trusted partner, not just a tool.
 */

import { GoogleGenAI } from "@google/genai";
import Constants from "expo-constants";
import {
  callMCPTool,
  checkMCPHealth,
  listMCPTools,
  type MCPTool
} from "../mcp-client";
import { getPreferences, preferencesToUserContext } from "../preferences";
import {
  checkMemoryHealth,
  getRelevantMemories,
  learnFromConversation,
  loadSoul,
  saveSoul,
  storeConversationMemory
} from "./memory";
import { DEFAULT_SOUL, evolveSoul, generateSystemPrompt } from "./soul";
import type {
  AgentContext,
  AgentEventCallback,
  AgentResponse,
  AgentSoul,
  ToolCall
} from "./types";

// =============================================================================
// CONFIGURATION
// =============================================================================

const API_KEY =
  Constants.expoConfig?.extra?.geminiKey ||
  process.env.EXPO_PUBLIC_GEMINIKEY ||
  process.env.GEMINI_API_KEY;

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : new GoogleGenAI({});

const MODEL = "gemini-3-flash-preview";
const FALLBACK_MODEL = "gemini-2.5-flash";
const MAX_TOOL_ITERATIONS = 8;

// =============================================================================
// BRAIN STATE
// =============================================================================

interface BrainState {
  initialized: boolean;
  soul: AgentSoul | null;
  mcpTools: MCPTool[];
  mcpConnected: boolean;
  memoryConnected: boolean;
}

const state: BrainState = {
  initialized: false,
  soul: null,
  mcpTools: [],
  mcpConnected: false,
  memoryConnected: false,
};

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Initialize the 2nd Brain agent.
 * Loads soul from memory, connects to MCP, etc.
 */
export async function initializeBrain(jwtToken?: string): Promise<{
  success: boolean;
  soul: AgentSoul;
  mcpConnected: boolean;
  memoryConnected: boolean;
}> {
  try {
    // Check memory health first if we have a token
    if (jwtToken) {
      const memoryHealth = await checkMemoryHealth();
      
      if (memoryHealth.healthy) {
        try {
          state.soul = await loadSoul(jwtToken);
          state.memoryConnected = true;
          console.log("✅ Memory connected, soul loaded");
        } catch (e: any) {
          console.warn("Failed to load soul from memory:", e.message);
          state.soul = { ...DEFAULT_SOUL, createdAt: Date.now() };
          state.memoryConnected = false;
        }
      } else {
        console.warn("Memory service not healthy:", memoryHealth.error);
        state.soul = { ...DEFAULT_SOUL, createdAt: Date.now() };
        state.memoryConnected = false;
      }
      // Overlay preferences from MongoDB (profile) onto soul.userContext
      try {
        const prefs = await getPreferences(jwtToken);
        const overlay = preferencesToUserContext(prefs);
        if (Object.keys(overlay).some((k) => (overlay as any)[k] != null)) {
          state.soul = evolveSoul(state.soul!, overlay);
          console.log("✅ Preferences merged into soul");
          await saveSoul(state.soul, jwtToken);
        }
      } catch (e: any) {
        console.warn("Failed to load preferences for soul:", e.message);
      }
    } else {
      console.log("No JWT token, using default soul");
      state.soul = { ...DEFAULT_SOUL, createdAt: Date.now() };
      state.memoryConnected = false;
    }

    // Check MCP connection
    const mcpHealth = await checkMCPHealth();
    state.mcpConnected = mcpHealth.healthy;
    
    if (state.mcpConnected) {
      try {
        state.mcpTools = await listMCPTools();
        console.log(`✅ MCP connected with ${state.mcpTools.length} tools`);
      } catch (e: any) {
        console.warn("Failed to list MCP tools:", e.message);
        state.mcpConnected = false;
      }
    } else {
      console.log("MCP not available:", mcpHealth.error);
    }

    state.initialized = true;

    console.log(`✅ 2nd Brain initialized: ${state?.soul?.name}`);
    console.log(`   MCP: ${state.mcpConnected ? "connected" : "offline"}`);
    console.log(`   Memory: ${state.memoryConnected ? "connected" : "offline"}`);

    return {
      success: true,
      soul: state.soul,
      mcpConnected: state.mcpConnected,
      memoryConnected: state.memoryConnected,
    };
  } catch (error: any) {
    console.error("Brain initialization failed:", error);
    state.soul = { ...DEFAULT_SOUL, createdAt: Date.now() };
    state.initialized = true;
    
    return {
      success: false,
      soul: state.soul,
      mcpConnected: false,
      memoryConnected: false,
    };
  }
}

/**
 * Get current brain state
 */
export function getBrainState(): BrainState {
  return { ...state };
}

/**
 * Get the agent's soul
 */
export function getSoul(): AgentSoul | null {
  return state.soul;
}

/**
 * Reinitialize brain - useful for reconnecting to services
 */
export async function reinitializeBrain(jwtToken?: string): Promise<{
  success: boolean;
  soul: AgentSoul;
  mcpConnected: boolean;
  memoryConnected: boolean;
}> {
  // Reset state
  state.initialized = false;
  state.mcpTools = [];
  state.mcpConnected = false;
  
  // Reinitialize
  return initializeBrain(jwtToken);
}

/**
 * Try to connect MCP only (without full reinitialization)
 */
export async function connectMCP(): Promise<boolean> {
  try {
    const mcpHealth = await checkMCPHealth();
    state.mcpConnected = mcpHealth.healthy;
    
    if (state.mcpConnected) {
      state.mcpTools = await listMCPTools();
      console.log(`✅ MCP connected with ${state.mcpTools.length} tools`);
      return true;
    }
    return false;
  } catch (e) {
    console.error("MCP connection failed:", e);
    return false;
  }
}

// =============================================================================
// SKILL DETECTION
// =============================================================================

/**
 * Detect which skills are relevant for a message
 */
function detectRelevantSkills(message: string, soul: AgentSoul): string[] {
  const messageLower = message.toLowerCase();
  const relevantSkills: string[] = [];

  for (const skill of soul.skills) {
    if (!skill.enabled) continue;
    
    for (const trigger of skill.triggers) {
      if (messageLower.includes(trigger.toLowerCase())) {
        relevantSkills.push(skill.id);
        break;
      }
    }
  }

  return relevantSkills;
}

/**
 * Determine if we need workspace (MCP) tools
 */
function needsWorkspace(skills: string[]): boolean {
  const workspaceSkills = ["gmail_manage", "calendar_manage", "drive_manage", "contacts_manage"];
  return skills.some(s => workspaceSkills.includes(s));
}

/**
 * Determine if this is a travel-related query (flights, hotels, etc.)
 */
function needsTravel(skills: string[], message: string): boolean {
  if (skills.includes("travel_search")) {
    const travelHints = [
      "flight", "flights", "fly", "flying", "airline",
      "hotel", "hotels", "stay", "accommodation", "book",
      "travel", "trip", "vacation", "holiday",
      "airport", "departure", "arrival", "outbound", "return date",
      "one way", "round trip",
      "cheapest flight", "budget hotel", "find budget",
      "check in", "check out", "check-in", "check-out",
      "hotel details", "hotel rating", "sort by price", "sort by rating",
    ];
    const query = message.toLowerCase();
    return travelHints.some((hint) => query.includes(hint));
  }
  return false;
}

function needsCalendar(skills: string[]): boolean {
  return skills.includes("calendar_manage");
}

function extractLocationFromMemory(memoryContext: string): string | null {
  const patterns = [
    /located in ([^\n]+)/i,
    /based in ([^\n]+)/i,
    /in ([A-Za-z\s]+)$/i,
    /i'm in ([^\n]+)/i,
    /i am in ([^\n]+)/i,
    /location: ([^\n.]+)/i,
    /live in ([^\n.]+)/i,
    /from ([^\n.]+)/i,
  ];

  for (const pattern of patterns) {
    const match = memoryContext.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

/** Request metadata injected before the prompt so the agent and MCPs get user context */
export interface RequestMetadata {
  userLocation: string;
  userTimezone: string;
  userDate: string;
  userName: string;
  essentialMemories: string;
}

/** Strip "## Relevant Memories" and normalize bullet lines for inclusion in metadata */
function stripMemoryHeader(text: string): string {
  return text.replace(/^## Relevant Memories\n?/i, "").trim();
}

/**
 * Build request metadata (location, timezone, date, name, essential memories)
 * from soul, preferences-derived userContext, and memory. Used to inject into
 * system instruction so the agent and tool calls (e.g. Travel MCP flight/hotel
 * location, Calendar timezone) use the right context.
 * @param identityMemories - Optional dedicated fetch for "user name, location, preferences" (merged first into essential memories)
 */
export function buildRequestMetadata(
  soul: AgentSoul,
  memoryContext: string,
  identityMemories?: string
): RequestMetadata {
  const now = new Date();
  const tz = soul.userContext.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  let userDate: string;
  try {
    userDate = now.toLocaleString(locale, { timeZone: tz, dateStyle: "full", timeStyle: "short" });
  } catch {
    userDate = now.toLocaleDateString() + " " + now.toLocaleTimeString();
  }
  const userName = soul.userContext.preferredName || "the user";
  const combinedMemory = [identityMemories, memoryContext].filter(Boolean).join("\n");
  const userLocation =
    soul.userContext.location ||
    (combinedMemory ? extractLocationFromMemory(combinedMemory) : null) ||
    "unknown";
  const essentialParts: string[] = [];
  if (identityMemories) {
    essentialParts.push(stripMemoryHeader(identityMemories));
  }
  if (memoryContext) {
    essentialParts.push(stripMemoryHeader(memoryContext));
  }
  const essentialMemories = essentialParts
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n");

  return {
    userLocation,
    userTimezone: soul.userContext.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    userDate,
    userName,
    essentialMemories,
  };
}

/** Format request metadata as a block for the system instruction */
export function formatRequestMetadataBlock(meta: RequestMetadata): string {
  const lines = [
    "## Request Metadata (use when calling tools and answering)",
    `- **User Location**: ${meta.userLocation}`,
    `- **User Timezone**: ${meta.userTimezone}`,
    `- **User Date/Time**: ${meta.userDate}`,
    `- **User Name**: ${meta.userName}`,
  ];
  if (meta.essentialMemories) {
    lines.push("- **Essential memories (use when relevant):**");
    lines.push(
      meta.essentialMemories
        .split("\n")
        .map((m) => m.replace(/^-\s*/, "  - "))
        .join("\n")
    );
  }
  lines.push(
    "\nUse this metadata: for Calendar use the user date/timezone; address the user by name when known. For Travel MCP use location context for flight/hotel searches. Prefer fetching or using the most relevant info from tools and memories to return the best result."
  );
  return lines.join("\n");
}

/**
 * Determine if we need web search via Gemini grounding (googleSearch).
 * Triggered by the web_search skill or by message keywords (realtime/lookup hints).
 * 
 * NOTE: This does NOT use Travel MCP. General web search (news, weather,
 * unit conversion, facts, social profiles, stocks, etc.) goes through
 * Gemini grounding. Travel MCP is reserved for flights & hotels only.
 */
function needsSearch(skills: string[], message: string): boolean {
  if (skills.includes("web_search")) {
    return true;
  }

  const query = message.toLowerCase();
  const realtimeHints = [
    "today",
    "current",
    "latest",
    "news",
    "price",
    "rate",
    "cost",
    "stock",
    "market",
    "silver",
    "gold",
    "crypto",
    "weather",
    "who won",
    "score",
    "election",
    "convert",
    "conversion",
    "how many",
    "how much is",
    "exchange rate",
  ];

  return realtimeHints.some((hint) => query.includes(hint));
}

/**
 * Determine if we need deep thinking
 */
function needsThinking(skills: string[]): boolean {
  return skills.includes("deep_think");
}

// =============================================================================
// TOOL BUILDING
// =============================================================================

/**
 * Travel MCP tools that should be excluded from function declarations.
 * These are NOT travel/flight/hotel tools — they are general search or utility
 * tools that we replace with Gemini grounding (googleSearch) for better results.
 */
const EXCLUDED_MCP_TOOLS = new Set([
  "search",           // General web search — use Gemini grounding instead
  "get_cache_stats",  // Internal utility, not user-facing
  "clear_cache",      // Internal utility, not user-facing
]);

/**
 * Build function declarations from MCP tools.
 * Filters out the Travel MCP `search` tool (and utilities) because we use
 * Gemini grounding (googleSearch) for general web queries instead.
 * Google Workspace MCP tools are passed through unchanged.
 */
function buildMCPFunctionDeclarations(): any[] {
  if (!state.mcpConnected || state.mcpTools.length === 0) {
    return [];
  }

  return state.mcpTools
    .filter((tool) => !EXCLUDED_MCP_TOOLS.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(tool.inputSchema.properties || {}).map(([key, value]) => [
            key,
            {
              type: value.type === "number" ? "number" : "string",
              description: value.description || "",
            },
          ])
        ),
        required: tool.inputSchema.required || [],
      },
    }));
}

// =============================================================================
// MAIN CHAT FUNCTION
// =============================================================================

/**
 * Send a message to 2nd Brain and get a response.
 * 
 * This is the main entry point for all interactions.
 */
export async function chat(
  message: string,
  context: AgentContext,
  onEvent?: AgentEventCallback
): Promise<AgentResponse> {
  const startTime = Date.now();
  const toolCalls: ToolCall[] = [];

  // Ensure brain is initialized
  if (!state.initialized || !state.soul) {
    await initializeBrain(context.jwtToken);
  }

  const soul = state.soul || DEFAULT_SOUL;

  // Detect relevant skills
  const skills = detectRelevantSkills(message, soul);
  const useWorkspace = needsWorkspace(skills) && state.mcpConnected;
  const useCalendar = needsCalendar(skills);
  const useTravel = needsTravel(skills, message) && state.mcpConnected;
  const useSearch = needsSearch(skills, message); // Gemini grounding (googleSearch) for general web queries
  const useThinking = true;

  onEvent?.({
    type: "thinking",
    data: { skills, useWorkspace, useTravel, useSearch, useThinking },
    timestamp: Date.now(),
  });

  // Get relevant memories (message-based) and dedicated identity/preferences memories for metadata
  let memoryContext = "";
  let identityMemories = "";
  if (context.jwtToken && state.memoryConnected) {
    onEvent?.({ type: "memory_access", data: { action: "searching" }, timestamp: Date.now() });
    const [messageMemories, identityMemoriesResult] = await Promise.all([
      getRelevantMemories(message, context.jwtToken, 5),
      getRelevantMemories("user name location preferences important facts", context.jwtToken, 5),
    ]);
    memoryContext = messageMemories;
    identityMemories = identityMemoriesResult;
  }

  // Build conversation history for API
  const historyContents = context.conversationHistory
    .filter((msg) => msg.role !== "assistant" || msg.content)
    .slice(-10)
    .map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

  // Build system instruction with soul + request metadata (before prompt)
  let systemInstruction = generateSystemPrompt(soul);
  const requestMeta = buildRequestMetadata(soul, memoryContext, identityMemories);
  systemInstruction += "\n\n" + formatRequestMetadataBlock(requestMeta);
  if (useTravel) {
    systemInstruction += `\n\n## Travel Request Detected\nThe user is asking about flights, hotels, or travel. Use Travel MCP (self-hosted SerpAPI): search_flights (specific dates), get_cheapest_flights (flexible dates), search_hotels, get_hotel_details (hotel_id from search), find_budget_hotels. Use IATA airport codes (LAX, JFK) and YYYY-MM-DD for dates. Do NOT guess prices or availability — call the appropriate tool.`;
  }
  if (useSearch) {
    systemInstruction += `\n\n## Web Search — Gemini Grounding\nFor general web queries (news, weather, unit conversion, facts, social profiles, stocks, "who is", "what is", current events, reviews, comparisons), you have **Gemini grounding (Google Search)** enabled automatically. Simply answer the query naturally — grounding will retrieve real-time web data behind the scenes. Do NOT attempt to use any MCP tool for general web search; grounding handles it.\nIf grounding is unavailable (e.g. because MCP tools are active for travel/workspace in this request), answer from your training knowledge and say so.`;
    systemInstruction += `\n\n## Source Priority\nGemini grounding (Google Search) takes precedence over memory for current/lookup info. Use memories for stable personal preferences.`;
  }
  if (useCalendar) {
    const now = new Date();
    const isoNow = now.toISOString();
    const tzOffsetMinutes = now.getTimezoneOffset();
    const timezone = soul.userContext.timezone || "unknown";
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const localDate = now.toLocaleDateString();
    const localTime = now.toLocaleTimeString();
    const locationHint = memoryContext ? extractLocationFromMemory(memoryContext) : null;
    const locationLine = locationHint
      ? `User location (from memory): ${locationHint}`
      : "User location: unknown";

    systemInstruction += `\n\n## Calendar Context\nCurrent date/time: ${localDate} ${localTime}\nCurrent ISO time: ${isoNow}\nTimezone offset (minutes): ${tzOffsetMinutes}\nUser timezone: ${timezone}\nLocale: ${locale}\n${locationLine}\nWhen interpreting relative dates like "today" or "tomorrow", use the current date above.`;
  }
  if (memoryContext) {
    systemInstruction += `\n\n${memoryContext}`;
  }

  // Build contents
  const contents = [
    ...historyContents,
    { role: "user", parts: [{ text: message }] },
  ];

  // Build tools array
  // IMPORTANT: Multi-tool use (combining googleSearch + functionDeclarations) is
  // only supported in the Live API, NOT in generateContent. We must pick one.
  //
  // Routing strategy:
  //   - Travel MCP: ONLY for flights & hotels (search_flights, search_hotels, etc.)
  //   - Google Workspace MCP: Gmail, Calendar, Drive, Contacts (unchanged)
  //   - Gemini grounding (googleSearch): news, facts, unit conversion, social
  //     profiles, general web search — anything NOT travel/workspace.
  //
  // When MCP tools AND search are both needed in the same request, MCP tools
  // take priority (API constraint). The model answers general search parts
  // from its training knowledge.
  const tools: any[] = [];
  const mcpFunctions = (useWorkspace || useTravel)
    ? buildMCPFunctionDeclarations()
    : [];

  if (mcpFunctions.length > 0) {
    // MCP function calling for workspace and/or travel tools
    tools.push({ functionDeclarations: mcpFunctions });
  } else if (useSearch) {
    // Gemini grounding for general web search (news, facts, social, etc.)
    tools.push({ googleSearch: {} });
  }

  // Agentic loop
  let iteration = 0;
  let currentContents = contents;
  let finalResponse: any = null;
  let lastModelUsed = MODEL;

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++;

    try {
      let response: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const modelToUse = attempt === 0 ? MODEL : FALLBACK_MODEL;
        try {
          response = await ai.models.generateContent({
            model: modelToUse,
            contents: currentContents,
            config: {
              systemInstruction,
              ...(useThinking && {
                thinkingConfig: {
                  thinkingBudget: 4000,
                  includeThoughts: true,
                },
              }),
              ...(tools.length > 0 && { tools }),
            },
          } as any);
          lastModelUsed = modelToUse;
          break;
        } catch (error) {
          if (attempt === 1) {
            throw error;
          }
        }
      }

      const responseAny = response as any;
      const candidates = responseAny.candidates || [];
      const firstCandidate = candidates[0];
      const parts = firstCandidate?.content?.parts || [];

      // Check for function calls
      const functionCallParts = parts.filter((p: any) => p.functionCall);

      if (functionCallParts.length === 0) {
        // No function calls - we have final response
        finalResponse = response;
        break;
      }

      // Process function calls
      const functionResponses: any[] = [];

      for (const part of functionCallParts) {
        const functionCall = part.functionCall;
        const toolName = functionCall.name;
        const toolArgs = functionCall.args || {};

        onEvent?.({
          type: "tool_call",
          data: { name: toolName, args: toolArgs },
          timestamp: Date.now(),
        });

        // Call MCP tool
        const result = await callMCPTool(toolName, toolArgs);
        const resultText = result.content
          .map((c: any) => c.text || JSON.stringify(c))
          .join("\n");

        toolCalls.push({
          name: toolName,
          args: toolArgs,
          result: resultText,
          status: result.isError ? "error" : "success",
        });

        onEvent?.({
          type: "tool_result",
          data: { name: toolName, success: !result.isError },
          timestamp: Date.now(),
        });

        functionResponses.push({
          functionResponse: {
            name: toolName,
            response: { result: resultText },
          },
        });
      }

      // Add to conversation for next iteration
      currentContents = [
        ...currentContents,
        { role: "model", parts: functionCallParts },
        { role: "user", parts: functionResponses },
      ];
    } catch (error: any) {
      console.error("Brain iteration error:", error);
      return {
        text: `I encountered an error: ${error.message}. Let me try a different approach.`,
        agentName: soul.name,
        toolCalls,
        metadata: { error: error.message },
      };
    }
  }

  // Extract final text
  const text = finalResponse?.text || "I wasn't able to complete that request. Could you try again?";

  // Extract thinking if available
  let thinking: string | undefined;
  if (useThinking) {
    const responseAny = finalResponse as any;
    const parts = responseAny?.candidates?.[0]?.content?.parts || [];
    const thoughtPart = parts.find((p: any) => p.thought);
    if (thoughtPart) {
      thinking = thoughtPart.text;
    }
  }

  const responseAny = finalResponse as any;
  const candidate = responseAny?.candidates?.[0];
  const groundingMetadata =
    candidate?.groundingMetadata ?? candidate?.content?.groundingMetadata;
  const chunks = groundingMetadata?.groundingChunks ?? groundingMetadata?.grounding_chunks;
  const citations = Array.isArray(chunks)
    ? chunks.map((chunk: any) => chunk?.web ?? chunk).filter(Boolean)
    : [];

  // Store conversation in memory (async, don't block)
  if (context.jwtToken && state.memoryConnected) {
    storeConversationMemory(message, text, context.jwtToken, {
      skillsUsed: skills,
      toolsUsed: toolCalls.map((t) => t.name),
    }).catch(console.error);

    learnFromConversation(context.conversationHistory, context.jwtToken).catch(
      console.error
    );
  }

  onEvent?.({ type: "complete", data: {}, timestamp: Date.now() });

  return {
    text,
    agentName: soul.name,
    toolCalls,
    thinking,
    metadata: {
      model: lastModelUsed,
      latencyMs: Date.now() - startTime,
      skillsUsed: skills,
      memoriesAccessed: memoryContext ? 1 : 0,
      groundingMetadata,
      citations,
    },
  };
}

// =============================================================================
// SESSION RESET
// =============================================================================

/**
 * Reset all in-memory brain state.
 * Call on logout so the next user gets a fresh brain.
 */
export function resetBrainState(): void {
  state.initialized = false;
  state.soul = null;
  state.mcpTools = [];
  state.mcpConnected = false;
  state.memoryConnected = false;
  console.log("🧹 Brain state reset");
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

export { DEFAULT_SOUL } from "./soul";
export type { AgentContext, AgentResponse, AgentSoul, ToolCall } from "./types";

