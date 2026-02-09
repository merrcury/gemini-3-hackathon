/**
 * useMCPAuth – React hook for MCP client authentication
 *
 * The server acts as an OAuth proxy:
 *   1. Client opens  server/auth/login?redirect=<app_url>  in a WebBrowser
 *   2. Server redirects to Google consent screen
 *   3. Google redirects back to the server (/auth/callback)
 *   4. Server exchanges the code for tokens, then redirects to the app URL
 *   5. App captures the redirect URL, extracts tokens, stores them
 *
 * No per-client redirect URI registration needed. Works on iOS, Android, & web.
 *
 * Also supports API key mode via EXPO_PUBLIC_MCP_API_KEY.
 */

import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  clearMCPGoogleToken,
  getMCPAuthStatus,
  getMCPServerURL,
  loadPersistedAuth,
  type MCPAuthMode,
  onAuthEvent,
  setMCPGoogleToken,
} from "../services/mcp-client";

// Ensure in-progress web browser auth sessions complete on return
WebBrowser.maybeCompleteAuthSession();

export interface MCPAuthState {
  /** Current auth mode: oauth | api_key | none */
  authMode: MCPAuthMode;
  /** True when Google OAuth token is valid (not just API key) */
  isAuthenticated: boolean;
  /** Whether the user has a valid Google OAuth connection */
  isGoogleConnected: boolean;
  /** True while OAuth flow or token load is in progress */
  isLoading: boolean;
  /** Token expired & refresh failed — user must re-login */
  needsRelogin: boolean;
  /** Error message from last auth attempt */
  error: string | null;
  /** Google OAuth token expiry timestamp (ms) or null */
  tokenExpiry: number | null;
}

export function useMCPAuth() {
  const [state, setState] = useState<MCPAuthState>({
    authMode: "none",
    isAuthenticated: false,
    isGoogleConnected: false,
    isLoading: true,
    needsRelogin: false,
    error: null,
    tokenExpiry: null,
  });

  // Track if we've already shown the re-login alert to avoid duplicates
  const reloginAlertShown = useRef(false);

  // Refresh state from mcp-client
  const refreshState = useCallback(() => {
    const status = getMCPAuthStatus();
    setState((prev) => ({
      ...prev,
      authMode: status.mode,
      isAuthenticated: status.isGoogleConnected,
      isGoogleConnected: status.isGoogleConnected,
      tokenExpiry: status.oauthTokenExpiry,
      // Clear needsRelogin if we now have a valid token
      needsRelogin: status.isGoogleConnected ? false : prev.needsRelogin,
    }));
  }, []);

  // Load persisted auth on mount
  useEffect(() => {
    loadPersistedAuth()
      .then(() => refreshState())
      .catch((e) => console.warn("MCP auth load error:", e))
      .finally(() => setState((prev) => ({ ...prev, isLoading: false })));
  }, [refreshState]);

  // Subscribe to auth events from mcp-client
  useEffect(() => {
    const unsubscribe = onAuthEvent((event) => {
      if (event === "needs_relogin") {
        setState((prev) => ({
          ...prev,
          needsRelogin: true,
          isAuthenticated: false,
          isGoogleConnected: false,
          authMode: getMCPAuthStatus().mode,
          tokenExpiry: null,
        }));

        // Show a one-time alert prompting re-login
        if (!reloginAlertShown.current) {
          reloginAlertShown.current = true;
          Alert.alert(
            "Session Expired",
            "Your Google session has expired. Please reconnect to continue using Google services.",
            [
              { text: "Later", style: "cancel" },
              {
                text: "Reconnect",
                onPress: () => {
                  // Trigger OAuth flow — we call promptGoogleOAuth via ref
                  promptGoogleOAuthRef.current?.();
                },
              },
            ],
          );
        }
      } else if (event === "token_refreshed") {
        reloginAlertShown.current = false;
        refreshState();
      } else if (event === "token_cleared") {
        reloginAlertShown.current = false;
        refreshState();
      }
    });

    return unsubscribe;
  }, [refreshState]);

  /**
   * Trigger Google OAuth via the MCP server's OAuth proxy.
   *
   * Opens a browser → server redirects to Google → Google consent →
   * server exchanges code → redirects back to app with tokens.
   */
  const promptGoogleOAuth = useCallback(async () => {
    // Build the app callback URL the server should redirect to after auth
    const callbackUrl = Linking.createURL("auth/callback");

    // Get the MCP server base URL (strip /mcp suffix)
    const mcpUrl = getMCPServerURL();
    if (!mcpUrl) {
      const msg = "MCP server URL not configured. Set EXPO_PUBLIC_MCP_SERVER_URL in .env";
      setState((prev) => ({ ...prev, error: msg }));
      return { success: false, error: msg };
    }
    const serverBase = mcpUrl.replace(/\/mcp\/?$/, "");

    // Build the login URL
    const loginUrl =
      `${serverBase}/auth/login?redirect=${encodeURIComponent(callbackUrl)}`;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Open browser — waits until redirect back to callbackUrl
      const result = await WebBrowser.openAuthSessionAsync(loginUrl, callbackUrl);

      if (result.type === "success" && result.url) {
        // Parse tokens from the redirect URL
        const parsed = Linking.parse(result.url);
        const params = parsed.queryParams ?? {};

        const accessToken =
          (params.access_token as string) || "";
        const refreshToken =
          (params.refresh_token as string) || "";
        const expiresIn = parseInt(
          (params.expires_in as string) || "3600",
          10
        );

        if (accessToken) {
          await setMCPGoogleToken(
            accessToken,
            expiresIn,
            refreshToken || undefined
          );
          reloginAlertShown.current = false;
          refreshState();
          setState((prev) => ({
            ...prev,
            isLoading: false,
            needsRelogin: false,
          }));
          return { success: true };
        }

        const msg = "No access token in redirect URL";
        setState((prev) => ({ ...prev, error: msg, isLoading: false }));
        return { success: false, error: msg };
      }

      if (result.type === "cancel" || result.type === "dismiss") {
        setState((prev) => ({
          ...prev,
          error: null, // user cancelled, not an error
          isLoading: false,
        }));
        return { success: false, error: "Cancelled" };
      }

      setState((prev) => ({ ...prev, error: "OAuth flow failed", isLoading: false }));
      return { success: false, error: "OAuth flow failed" };
    } catch (e: any) {
      const msg = e.message || "OAuth prompt failed";
      setState((prev) => ({ ...prev, error: msg, isLoading: false }));
      return { success: false, error: msg };
    }
  }, [refreshState]);

  // Ref so the auth event handler can trigger OAuth without stale closure
  const promptGoogleOAuthRef = useRef<(() => void) | null>(null);
  promptGoogleOAuthRef.current = promptGoogleOAuth;

  /**
   * Sign out: clear stored Google OAuth tokens.
   */
  const signOut = useCallback(async () => {
    await clearMCPGoogleToken();
    // clearMCPGoogleToken emits "token_cleared" which triggers refreshState
    // but call it explicitly too for immediate UI update
    refreshState();
  }, [refreshState]);

  return {
    ...state,
    promptGoogleOAuth,
    signOut,
    refreshState,
  };
}
