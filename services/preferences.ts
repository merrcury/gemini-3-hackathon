/**
 * User Preferences API
 *
 * Saves and loads user profile & agent context (bio, preferred name, timezone,
 * interests, work style, communication preferences, goals) to MongoDB via
 * the deployed Preferences API. Used by Profile UI and merged into soul in brain.
 * On save, preferences are also added to Mem0 via the memory /add endpoint.
 */

import Constants from "expo-constants";
import { addMemory } from "./agents/memory";
import { clearStoredJWT } from "./jwt";

const PREFERENCES_API_URL =
  Constants.expoConfig?.extra?.preferencesApiUrl ||
  process.env.EXPO_PUBLIC_PREFERENCES_API_URL ||
  "";

// Mirrors soul.userContext + profile-only fields
export interface UserPreferencesData {
  // Agent context (soul.userContext)
  preferredName?: string;
  timezone?: string;
  location?: string;
  interests?: string[];
  workStyle?: string;
  communicationPreferences?: string[];
  // Profile display
  name?: string;
  bio?: string;
  goals?: string[];
  aiCapabilities?: string[];
  avatarUri?: string; // optional; avoid huge base64 in production
}

export interface PreferencesDoc {
  user_id?: string;
  preferences: UserPreferencesData;
}

/**
 * Fetch all preferences for the current user (Bearer token = Clerk JWT).
 */
export async function getPreferences(
  jwtToken: string | null | undefined
): Promise<UserPreferencesData> {
  const token = (jwtToken ?? "").trim();
  if (!PREFERENCES_API_URL || !token) {
    return {};
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${PREFERENCES_API_URL}/preferences`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      if (response.status === 401) {
        console.warn("Preferences API: unauthorized — clearing stale JWT");
        clearStoredJWT().catch(() => {});
        // Throw so callers can distinguish "no profile" from "auth rejected"
        throw new Error("Preferences API: unauthorized (401)");
      }
      throw new Error(`Preferences API error: ${response.status}`);
    }
    const doc = (await response.json()) as PreferencesDoc;
    const prefs = doc?.preferences ?? {};
    return {
      preferredName: prefs.preferredName ?? prefs.name,
      timezone: prefs.timezone,
      location: prefs.location,
      interests: Array.isArray(prefs.interests) ? prefs.interests : [],
      workStyle: prefs.workStyle,
      communicationPreferences: Array.isArray(prefs.communicationPreferences)
        ? prefs.communicationPreferences
        : [],
      name: prefs.name,
      bio: prefs.bio,
      goals: Array.isArray(prefs.goals) ? prefs.goals : [],
      aiCapabilities: Array.isArray(prefs.aiCapabilities) ? prefs.aiCapabilities : [],
      avatarUri: prefs.avatarUri,
    };
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e?.name === "AbortError") {
      console.warn("Preferences API: request timeout");
      return {};
    }
    console.warn("Preferences API: get failed", e?.message);
    return {};
  }
}

/**
 * Build a text summary of preferences for Mem0 (searchable, agent-visible).
 */
function preferencesToMemoryContent(prefs: UserPreferencesData): string {
  const parts: string[] = [];
  const name = prefs.preferredName ?? prefs.name;
  if (name) parts.push(`User prefers to be called ${name}.`);
  if (prefs.bio) parts.push(`Bio: ${prefs.bio}`);
  if (prefs.timezone) parts.push(`Timezone: ${prefs.timezone}`);
  if (prefs.location) parts.push(`Location: ${prefs.location}.`);
  if (prefs.workStyle) parts.push(`Work style: ${prefs.workStyle}`);
  if (prefs.interests?.length)
    parts.push(`Interests: ${prefs.interests.join(", ")}`);
  if (prefs.communicationPreferences?.length)
    parts.push(`Communication: ${prefs.communicationPreferences.join(", ")}`);
  if (prefs.goals?.length) parts.push(`Goals: ${prefs.goals.join(", ")}`);
  if (prefs.aiCapabilities?.length)
    parts.push(`Preferred AI capabilities: ${prefs.aiCapabilities.join(", ")}`);
  return parts.length ? parts.join(" ") : "User profile updated.";
}

/**
 * Save entire preferences object (overwrites server-side).
 * Also adds a preferences summary to Mem0 via the /add endpoint so the agent can recall them.
 */
export async function setPreferences(
  jwtToken: string | null | undefined,
  preferences: UserPreferencesData
): Promise<{ success: boolean; error?: string }> {
  const token = (jwtToken ?? "").trim();
  if (!PREFERENCES_API_URL || !token) {
    return { success: false, error: "Missing API URL or token" };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${PREFERENCES_API_URL}/preferences`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ preferences }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      if (response.status === 401) {
        console.warn("Preferences API: unauthorized on save — clearing stale JWT");
        clearStoredJWT().catch(() => {});
      }
      const text = await response.text();
      return { success: false, error: text || `HTTP ${response.status}` };
    }
    // Persist preferences to Mem0 so the agent can recall them
    const content = preferencesToMemoryContent(preferences);
    addMemory(
      [{ role: "system", content }],
      token,
      { type: "preferences" }
    ).then((r) => {
      if (!r.success) console.warn("Preferences not saved to memory:", r.error);
    });
    return { success: true };
  } catch (e: any) {
    clearTimeout(timeoutId);
    return { success: false, error: e?.message ?? "Request failed" };
  }
}

/** Shape used to overlay soul.userContext from saved preferences */
export interface UserContextOverlay {
  preferredName?: string;
  timezone?: string;
  location?: string;
  interests?: string[];
  workStyle?: string;
  communicationPreferences?: string[];
  aiCapabilities?: string[];
}

/**
 * Map preferences doc to soul userContext shape for brain/soul.
 */
export function preferencesToUserContext(
  prefs: UserPreferencesData
): UserContextOverlay {
  return {
    preferredName: prefs.preferredName || prefs.name,
    timezone: prefs.timezone,
    location: prefs.location,
    interests: prefs.interests?.length ? prefs.interests : undefined,
    workStyle: prefs.workStyle,
    communicationPreferences: prefs.communicationPreferences?.length
      ? prefs.communicationPreferences
      : undefined,
    aiCapabilities: prefs.aiCapabilities?.length ? prefs.aiCapabilities : undefined,
  };
}
