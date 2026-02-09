/**
 * MCP OAuth for mobile apps: PKCE flow using Expo APIs so it works in Expo Go,
 * development builds, and production on iOS and Android.
 * 1) makeRedirectUri() for correct redirect on each platform
 * 2) expo-crypto for PKCE code_verifier / code_challenge
 * 3) expo-web-browser for auth session
 * 4) Exchange code at MCP server POST /token, store Bearer in SecureStore.
 */

import * as AuthSession from "expo-auth-session";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import {
    deleteSecureItemAsync,
    getSecureItemAsync,
    setSecureItemAsync,
} from "./secure-storage";

const MCP_BEARER_KEY = "@mcp_bearer_token";

// Google Workspace scopes (must match server SCOPES)
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/contacts",
];

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function getGoogleMcpBaseUrl(): string {
  const extra = Constants.expoConfig?.extra ?? {};
  const url =
    (extra as { mcpServerUrl?: string }).mcpServerUrl ||
    process.env.EXPO_PUBLIC_MCP_SERVER_URL ||
    "";
  return url.replace(/\/$/, "");
}

function getGoogleClientId(): string {
  const extra = Constants.expoConfig?.extra ?? {};
  return (
    (extra as { googleClientId?: string }).googleClientId ||
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
    ""
  );
}

/**
 * Redirect URI that works on iOS, Android, and Expo Go.
 * Uses the app scheme from app.config.js (agentcore) and path oauth2redirect.
 * In Expo Go you may get exp://...; add that to Google Console for local dev.
 */
function getRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: "agentcore",
    path: "oauth2redirect",
    preferLocalhost: false,
  });
}

const BASE64URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Base64url encode bytes (no +/, no padding). Works in React Native (no btoa/Buffer). */
function base64UrlEncode(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    const a = bytes[i++];
    const b = i < len ? bytes[i++] : 0;
    const c = i < len ? bytes[i++] : 0;
    result += BASE64URL_CHARS[a >>> 2];
    result += BASE64URL_CHARS[((a & 3) << 4) | (b >>> 4)];
    result += i > len + 1 ? "" : BASE64URL_CHARS[((b & 15) << 2) | (c >>> 6)];
    result += i > len ? "" : BASE64URL_CHARS[c & 63];
  }
  return result;
}

/** Generate PKCE code_verifier (43–128 chars) and code_challenge (base64url(SHA256(verifier))). */
async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const codeVerifier = base64UrlEncode(bytes);
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    codeVerifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  const codeChallenge = hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { codeVerifier, codeChallenge };
}

export async function getMcpBearerToken(): Promise<string | null> {
  try {
    return await getSecureItemAsync(MCP_BEARER_KEY);
  } catch {
    return null;
  }
}

export async function setMcpBearerToken(token: string): Promise<void> {
  await setSecureItemAsync(MCP_BEARER_KEY, token);
}

export async function clearMcpBearerToken(): Promise<void> {
  await deleteSecureItemAsync(MCP_BEARER_KEY);
}

export type TriggerMcpAuthResult = { success: true; token: string } | { success: false; error: string };

/**
 * Mobile-first OAuth: build auth URL with PKCE, open in browser, on redirect exchange code at /token.
 * Works in Expo Go (use the redirect URI shown in the error or add exp://... to Google Console),
 * and in dev/standalone builds with scheme agentcore://oauth2redirect.
 */
export async function triggerMcpAuth(): Promise<TriggerMcpAuthResult> {
  const baseUrl = getGoogleMcpBaseUrl();
  const clientId = getGoogleClientId();

  if (!baseUrl) {
    return { success: false, error: "MCP server URL not set (EXPO_PUBLIC_MCP_SERVER_URL)" };
  }
  if (!clientId) {
    return { success: false, error: "Google Client ID not set (EXPO_PUBLIC_GOOGLE_CLIENT_ID)" };
  }
  if (
    baseUrl.includes("localhost") ||
    baseUrl.startsWith("http://127.0.0.1") ||
    baseUrl.startsWith("https://127.0.0.1")
  ) {
    return {
      success: false,
      error: "OAuth requires a deployed MCP server (not localhost). Use a tunnel (e.g. ngrok) or deploy the server.",
    };
  }

  const redirectUri = getRedirectUri();
  const { codeVerifier, codeChallenge } = await generatePKCE();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

  // Open browser; when user completes sign-in, Google redirects to redirectUri with ?code=...
  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri, {
    preferEphemeralSession: false,
  });

  if (result.type !== "success" || !result.url) {
    if (result.type === "cancel" || result.type === "dismiss") {
      return { success: false, error: "Sign-in was cancelled" };
    }
    return { success: false, error: "Sign-in did not complete" };
  }

  const url = result.url;
  const qs = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const redirectParams = new URLSearchParams(qs);
  const code = redirectParams.get("code") ?? url.match(/[?&]code=([^&]+)/)?.[1];
  const errorParam = redirectParams.get("error") ?? url.match(/[?&]error=([^&]+)/)?.[1];

  if (errorParam) {
    return { success: false, error: decodeURIComponent(errorParam) || "Authorization failed" };
  }
  if (!code) {
    return { success: false, error: "No authorization code in redirect" };
  }

  const tokenUrl = `${baseUrl}/token`;
  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: code.trim(),
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });
    const data = (await res.json()) as { access_token?: string; error?: string };
    if (!res.ok) {
      return { success: false, error: data.error || `Server ${res.status}` };
    }
    if (!data.access_token) {
      return { success: false, error: "Server did not return access_token" };
    }
    await setMcpBearerToken(data.access_token);
    return { success: true, token: data.access_token };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Token exchange failed: ${message}` };
  }
}

/**
 * Call this when the app loads the OAuth redirect (e.g. from a deep link).
 * Helps dismiss the browser on some platforms. Root layout already calls WebBrowser.maybeCompleteAuthSession() on mount.
 */
export function maybeCompleteAuthSession(): void {
  WebBrowser.maybeCompleteAuthSession();
}

/** Get the redirect URI used for OAuth (so users can add it to Google Console). */
export function getRedirectUriForDisplay(): string {
  return getRedirectUri();
}
