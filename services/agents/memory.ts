/**
 * Memory Service
 * 
 * Integrates with the Mem0 backend for long-term memory storage and retrieval.
 * Handles soul persistence, conversation memories, and user preferences.
 */

import Constants from "expo-constants";
import { clearStoredJWT } from "../jwt";
import { DEFAULT_SOUL } from "./soul";
import type { AgentSoul, ConversationMessage } from "./types";

// Memory API URL - must be set via EXPO_PUBLIC_MEMORY_API_URL in .env
const MEMORY_API_URL =
  Constants.expoConfig?.extra?.memoryApiUrl ||
  process.env.EXPO_PUBLIC_MEMORY_API_URL ||
  "";

// Soul storage key prefix
const SOUL_MEMORY_KEY = "__2nd_brain_soul__";

interface MemoryMessage {
  role: string;
  content: string;
}

interface MemorySearchResult {
  memory: string;
  score?: number;
  metadata?: Record<string, any>;
}

// =============================================================================
// CORE MEMORY OPERATIONS
// =============================================================================

/**
 * Add memories to the backend
 */
export async function addMemory(
  messages: MemoryMessage[],
  jwtToken: string,
  metadata?: Record<string, any>
): Promise<{ success: boolean; data?: any; error?: string }> {
  const token = (jwtToken || "").trim();
  if (!token) {
    return { success: false, error: "No JWT token (sign in and use Clerk JWT template for memory)" };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(`${MEMORY_API_URL}/add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages,
        metadata: metadata || {},
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 401) {
        console.warn("Memory add 401 — clearing stale JWT");
        clearStoredJWT().catch(() => {});
      }
      return { success: false, error };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    // Handle CORS and network errors gracefully
    if (error.message?.includes("Failed to fetch") || error.name === "AbortError") {
      console.warn("Memory add unavailable (CORS or network issue)");
      return { success: false, error: "Memory service unavailable from web" };
    }
    
    console.error("Memory add error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Search memories based on a query
 */
export async function searchMemory(
  query: string,
  jwtToken: string,
  limit: number = 5
): Promise<{ results: MemorySearchResult[]; error?: string }> {
  const token = (jwtToken || "").trim();
  if (!token) {
    return { results: [], error: "No JWT token (sign in and use Clerk JWT template for memory)" };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(
      `${MEMORY_API_URL}/search?query=${encodeURIComponent(query)}&limit=${limit}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401) {
        console.warn("Memory search 401 — clearing stale JWT");
        clearStoredJWT().catch(() => {});
      }
      return { results: [], error: await response.text() };
    }

    const data = await response.json();
    const results = Array.isArray(data)
      ? data
      : Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.results?.results)
          ? data.results.results
          : [];
    return { results };
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    // Handle CORS and network errors gracefully
    if (error.message?.includes("Failed to fetch") || error.name === "AbortError") {
      console.warn("Memory search unavailable (CORS or network issue)");
      return { results: [], error: "Memory service unavailable from web" };
    }
    
    console.error("Memory search error:", error);
    return { results: [], error: error.message };
  }
}

/**
 * Get all memories for the user
 */
export async function getAllMemories(
  jwtToken: string
): Promise<{ memories: any[]; error?: string }> {
  const token = (jwtToken || "").trim();
  if (!token) {
    return { memories: [], error: "No JWT token" };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(`${MEMORY_API_URL}/memories`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { memories: [], error: await response.text() };
    }

    const data = await response.json();
    const memories = Array.isArray(data)
      ? data
      : Array.isArray(data?.memories)
        ? data.memories
        : [];
    return { memories };
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    // Handle CORS and network errors gracefully
    if (error.message?.includes("Failed to fetch") || error.name === "AbortError") {
      console.warn("Memory fetch unavailable (CORS or network issue)");
      return { memories: [], error: "Memory service unavailable from web" };
    }
    
    console.error("Memory fetch error:", error);
    return { memories: [], error: error.message };
  }
}

// =============================================================================
// SOUL PERSISTENCE
// =============================================================================

/**
 * Save the agent's soul to memory
 */
export async function saveSoul(
  soul: AgentSoul,
  jwtToken: string
): Promise<boolean> {
  try {
    const result = await addMemory(
      [
        {
          role: "system",
          content: `${SOUL_MEMORY_KEY}${JSON.stringify(soul)}`,
        },
      ],
      jwtToken,
      { type: "soul", version: soul.version }
    );
    return result.success;
  } catch (error) {
    console.error("Failed to save soul:", error);
    return false;
  }
}

/**
 * Load the agent's soul from memory, or create default if not found
 */
export async function loadSoul(jwtToken: string): Promise<AgentSoul> {
  try {
    const { memories } = await getAllMemories(jwtToken);
    const safeMemories = Array.isArray(memories) ? memories : [];
    
    // Find the soul memory
    for (const memory of safeMemories) {
      const content = memory.memory || memory.content || "";
      if (content.includes(SOUL_MEMORY_KEY)) {
        try {
          const jsonStr = content.replace(SOUL_MEMORY_KEY, "");
          const soul = JSON.parse(jsonStr);
          console.log("✅ Soul loaded from memory:", soul.name);
          return soul;
        } catch (e) {
          console.warn("Failed to parse soul from memory");
        }
      }
    }
    
    // No soul found - create default
    console.log("🆕 Creating new soul...");
    const newSoul = { ...DEFAULT_SOUL, createdAt: Date.now() };
    await saveSoul(newSoul, jwtToken);
    return newSoul;
  } catch (error) {
    console.error("Failed to load soul:", error);
    return { ...DEFAULT_SOUL, createdAt: Date.now() };
  }
}

/**
 * Update and save the soul
 */
export async function updateSoul(
  currentSoul: AgentSoul,
  updates: Partial<AgentSoul>,
  jwtToken: string
): Promise<AgentSoul> {
  const updatedSoul = { ...currentSoul, ...updates };
  await saveSoul(updatedSoul, jwtToken);
  return updatedSoul;
}

// =============================================================================
// CONVERSATION MEMORY
// =============================================================================

/**
 * Store important parts of a conversation
 */
export async function storeConversationMemory(
  userMessage: string,
  assistantResponse: string,
  jwtToken: string,
  metadata?: Record<string, any>
): Promise<boolean> {
  try {
    const result = await addMemory(
      [
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantResponse },
      ],
      jwtToken,
      {
        type: "conversation",
        timestamp: Date.now(),
        ...metadata,
      }
    );
    return result.success;
  } catch (error) {
    console.error("Failed to store conversation:", error);
    return false;
  }
}

/**
 * Get relevant memories for the current context
 */
export async function getRelevantMemories(
  query: string,
  jwtToken: string,
  limit: number = 5
): Promise<string> {
  try {
    const { results } = await searchMemory(query, jwtToken, limit);
    const mergedResults: MemorySearchResult[] = Array.isArray(results) ? [...results] : [];
    const normalizedQuery = query.toLowerCase();
    const identityHints = [
      "my name",
      "who am i",
      "what is my name",
      "where do i work",
      "what do i do",
      "my job",
      "my company",
      "my role",
      "my title",
      "where do i live",
      "where am i located",
    ];

    const shouldExpandIdentitySearch = identityHints.some((hint) =>
      normalizedQuery.includes(hint)
    );

    if (shouldExpandIdentitySearch && mergedResults.length < limit) {
      const extraQueries = ["name", "work", "company", "job", "role", "location"];
      for (const extraQuery of extraQueries) {
        const { results: extraResults } = await searchMemory(extraQuery, jwtToken, limit);
        const safeExtraResults = Array.isArray(extraResults) ? extraResults : [];
        for (const extraResult of safeExtraResults) {
          if (!mergedResults.some((r) => r.memory === extraResult.memory)) {
            mergedResults.push(extraResult);
          }
        }
      }
    }
    
    if (mergedResults.length === 0) {
      return "";
    }
    
    // Format memories as context
    const memoryTexts = mergedResults
      .map((r) => r.memory)
      .filter((m) => !m.includes(SOUL_MEMORY_KEY)); // Exclude soul from context
    
    if (memoryTexts.length === 0) {
      return "";
    }
    
    return `## Relevant Memories\n${memoryTexts.map((m) => `- ${m}`).join("\n")}`;
  } catch (error) {
    console.error("Failed to get relevant memories:", error);
    return "";
  }
}

// =============================================================================
// USER PREFERENCE LEARNING
// =============================================================================

/**
 * Extract and store user preferences from a conversation
 */
export async function learnFromConversation(
  messages: ConversationMessage[],
  jwtToken: string
): Promise<void> {
  // Look for preference indicators in recent messages
  const recentMessages = messages.slice(-6);
  const content = recentMessages.map((m) => m.content).join("\n");
  
  // Simple heuristics for preference detection
  const preferencePatterns = [
    /my name is (\w+)/i,
    /call me (\w+)/i,
    /i prefer (\w+)/i,
    /i like (\w+)/i,
    /i'm interested in (.+)/i,
    /i work in (.+)/i,
    /i'm a (.+)/i,
  ];
  
  const detectedPreferences: string[] = [];
  
  for (const pattern of preferencePatterns) {
    const match = content.match(pattern);
    if (match) {
      detectedPreferences.push(match[0]);
    }
  }
  
  if (detectedPreferences.length > 0) {
    await addMemory(
      [
        {
          role: "system",
          content: `User preferences detected: ${detectedPreferences.join("; ")}`,
        },
      ],
      jwtToken,
      { type: "preferences" }
    );
  }
}

// =============================================================================
// MEMORY HEALTH CHECK
// =============================================================================

/**
 * Check if memory service is available
 */
export async function checkMemoryHealth(): Promise<{
  healthy: boolean;
  status?: any;
  error?: string;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(`${MEMORY_API_URL}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      return { healthy: true, status: data };
    }
    return { healthy: false, error: `Status: ${response.status}` };
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      return { healthy: false, error: "Connection timeout" };
    }
    return { healthy: false, error: error.message };
  }
}

export function getMemoryApiUrl(): string {
  return MEMORY_API_URL;
}
