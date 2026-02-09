/**
 * Session Management
 *
 * Handles clearing all user data on logout so the next sign-in / sign-up
 * gets a clean slate: fresh chat, proper onboarding for new users, and
 * no stale tokens or brain state.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { resetBrainState } from "./agents";
import { clearStoredJWT } from "./jwt";
import { clearMCPGoogleToken } from "./mcp-client";

// ---------------------------------------------------------------------------
// Storage keys used across the app (keep in sync with their source files)
// ---------------------------------------------------------------------------

/** Chat messages & session — from chat.tsx */
const CHAT_STORAGE_KEY = "chat_session_v1";

/** Onboarding completion flag — from _layout.tsx / onboarding.tsx */
const ONBOARDING_STORAGE_KEY = "userProfile";

/** Legacy API service keys — from services/api.ts */
const LEGACY_JWT_KEY = "@chat_jwt_token";
const LEGACY_USER_ID_KEY = "@chat_user_id";

// ---------------------------------------------------------------------------
// Clear helpers
// ---------------------------------------------------------------------------

/**
 * Clear all user-specific data from the device.
 *
 * Call this **before** Clerk `signOut()` so everything is wiped while we
 * still have access to SecureStore and other APIs.
 *
 * What gets cleared:
 * - Chat messages (AsyncStorage)
 * - Onboarding state (AsyncStorage) — so new users see onboarding again
 * - JWT tokens (SecureStore)
 * - MCP Google OAuth tokens (SecureStore)
 * - Legacy API tokens (AsyncStorage)
 * - In-memory brain state (soul, MCP tools, memory connection)
 */
export async function clearAllUserData(): Promise<void> {
  console.log("🧹 Clearing all user data…");

  // 1. AsyncStorage keys
  const asyncKeys = [
    CHAT_STORAGE_KEY,
    ONBOARDING_STORAGE_KEY,
    LEGACY_JWT_KEY,
    LEGACY_USER_ID_KEY,
  ];
  await AsyncStorage.multiRemove(asyncKeys).catch((e) =>
    console.warn("AsyncStorage clear error:", e),
  );

  // 2. SecureStore / JWT
  await clearStoredJWT().catch((e) =>
    console.warn("JWT clear error:", e),
  );

  // 3. MCP Google OAuth tokens (SecureStore)
  await clearMCPGoogleToken().catch((e) =>
    console.warn("MCP token clear error:", e),
  );

  // 4. In-memory brain state
  resetBrainState();

  console.log("✅ All user data cleared");
}

/**
 * Clear only the chat session (messages + session ID).
 * Use for "New Chat" without logging the user out.
 */
export async function clearChatSession(): Promise<void> {
  await AsyncStorage.removeItem(CHAT_STORAGE_KEY).catch((e) =>
    console.warn("Chat clear error:", e),
  );
  console.log("🧹 Chat session cleared");
}
