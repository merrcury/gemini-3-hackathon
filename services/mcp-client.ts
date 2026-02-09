/**
 * MCP Client for connecting to one or more MCP servers
 *
 * Supports Google Workspace (primary), Travel MCP, and Kite. Tools from all
 * healthy servers are aggregated; tool calls are routed to the correct server.
 *
 * Auth modes per server:
 *   - Google Workspace: OAuth → Authorization: Bearer <access_token>
 *   - Travel MCP:       static API key → X-API-Key header
 */

import Constants from "expo-constants";
import {
	deleteSecureItemAsync,
	getSecureItemAsync,
	setSecureItemAsync,
} from "./secure-storage";

// =============================================================================
// CONFIGURATION
// =============================================================================

const extra = Constants.expoConfig?.extra ?? {};

// Primary: Google Workspace MCP
const MCP_GOOGLE_URL =
	extra.mcpServerUrl || process.env.EXPO_PUBLIC_MCP_SERVER_URL || "";

// Optional: Kite MCP
const MCP_KITE_URL =
	extra.mcpKiteUrl || process.env.EXPO_PUBLIC_MCP_KITE_URL || "";

// Travel MCP (self-hosted SerpAPI): flights & hotels only (general web search uses Gemini grounding).
// - EXPO_PUBLIC_MCP_TRAVEL_URL = Travel server URL (e.g. https://travel-mcp-server-xxx.run.app/mcp)
// - EXPO_PUBLIC_MCP_API_KEY = static API key sent as X-API-Key header
// - EXPO_PUBLIC_SERPAPI_API_KEY = fallback: hosted mcp.serpapi.com (no Travel URL needed)
const MCP_TRAVEL_URL =
	extra.mcpTravelUrl ||
	(typeof process !== "undefined" && process.env?.EXPO_PUBLIC_MCP_TRAVEL_URL) ||
	"";

const SERPAPI_API_KEY =
	extra.serpApiKey ||
	(typeof process !== "undefined" && process.env?.EXPO_PUBLIC_SERPAPI_API_KEY) ||
	"";

// API Key for simple auth (Travel MCP, etc.)
const MCP_API_KEY =
	extra.mcpApiKey ||
	(typeof process !== "undefined" && process.env?.EXPO_PUBLIC_MCP_API_KEY) ||
	"";

// Google Client ID no longer needed client-side — server handles OAuth proxy

// =============================================================================
// AUTH STATE & STORAGE
// =============================================================================

const SECURE_KEYS = {
	googleAccessToken: "mcp_google_access_token",
	googleRefreshToken: "mcp_google_refresh_token",
	googleTokenExpiry: "mcp_google_token_expiry",
} as const;

// In-memory cache (avoids hitting SecureStore every request)
let _googleAccessToken: string | null = null;
let _googleRefreshToken: string | null = null;
let _googleTokenExpiry: number = 0;
let _authInitialized = false;

// =============================================================================
// AUTH EVENT SYSTEM
// =============================================================================
// Allows the UI layer (useMCPAuth hook) to react when auth state changes
// without polling. Events:
//   - "needs_relogin"  : token expired & refresh failed → prompt user
//   - "token_refreshed": token was successfully refreshed
//   - "token_cleared"  : user signed out or tokens were purged

export type AuthEventType = "needs_relogin" | "token_refreshed" | "token_cleared";
type AuthEventCallback = (event: AuthEventType) => void;

const _authCallbacks: Set<AuthEventCallback> = new Set();

/** Subscribe to auth events. Returns an unsubscribe function. */
export function onAuthEvent(cb: AuthEventCallback): () => void {
	_authCallbacks.add(cb);
	return () => { _authCallbacks.delete(cb); };
}

function emitAuthEvent(event: AuthEventType) {
	_authCallbacks.forEach((cb) => {
		try { cb(event); } catch (e) { console.warn("Auth event callback error:", e); }
	});
}

// =============================================================================
// AUTH MODE & STATUS
// =============================================================================

/** Auth mode for MCP connections */
export type MCPAuthMode = "oauth" | "api_key" | "none";

/** Get current auth mode based on available credentials */
export function getMCPAuthMode(): MCPAuthMode {
	if (_googleAccessToken && _googleTokenExpiry > Date.now()) return "oauth";
	if (MCP_API_KEY) return "api_key";
	return "none";
}

/** Whether the user has a valid Google OAuth token (distinct from API key). */
export function isGoogleConnected(): boolean {
	return !!_googleAccessToken && _googleTokenExpiry > Date.now();
}

/** Get auth status details */
export function getMCPAuthStatus(): {
  mode: MCPAuthMode;
  hasApiKey: boolean;
  hasOAuthToken: boolean;
  isGoogleConnected: boolean;
  oauthTokenExpiry: number | null;
} {
  return {
    mode: getMCPAuthMode(),
    hasApiKey: !!MCP_API_KEY,
    hasOAuthToken: !!_googleAccessToken,
    isGoogleConnected: isGoogleConnected(),
    oauthTokenExpiry: _googleTokenExpiry > 0 ? _googleTokenExpiry : null,
  };
}

/**
 * Load persisted OAuth tokens from SecureStore into memory.
 * Call once at app startup (e.g. in useMCPAuth hook).
 */
export async function loadPersistedAuth(): Promise<void> {
	if (_authInitialized) return;
	try {
		const [token, refresh, expiry] = await Promise.all([
			getSecureItemAsync(SECURE_KEYS.googleAccessToken),
			getSecureItemAsync(SECURE_KEYS.googleRefreshToken),
			getSecureItemAsync(SECURE_KEYS.googleTokenExpiry),
		]);
		if (token && expiry) {
			const expiryMs = parseInt(expiry, 10);
			if (expiryMs > Date.now()) {
				_googleAccessToken = token;
				_googleRefreshToken = refresh;
				_googleTokenExpiry = expiryMs;
				console.log("MCP auth: loaded persisted OAuth token");
			} else {
				console.log("MCP auth: persisted token expired, clearing");
				await clearMCPGoogleToken();
			}
		}
	} catch (e) {
		console.warn("MCP auth: failed to load persisted tokens:", e);
	}
	_authInitialized = true;
}

/**
 * Store Google OAuth tokens (call after OAuth flow completes).
 */
export async function setMCPGoogleToken(
	accessToken: string,
	expiresIn: number = 3600,
	refreshToken?: string,
): Promise<void> {
	_googleAccessToken = accessToken;
	_googleTokenExpiry = Date.now() + expiresIn * 1000;
	if (refreshToken) _googleRefreshToken = refreshToken;

	await Promise.all([
		setSecureItemAsync(SECURE_KEYS.googleAccessToken, accessToken),
		setSecureItemAsync(
			SECURE_KEYS.googleTokenExpiry,
			_googleTokenExpiry.toString(),
		),
		...(refreshToken
			? [setSecureItemAsync(SECURE_KEYS.googleRefreshToken, refreshToken)]
			: []),
	]);
	console.log("MCP auth: Google OAuth token stored");
}

/**
 * Clear stored Google OAuth token.
 */
export async function clearMCPGoogleToken(): Promise<void> {
	_googleAccessToken = null;
	_googleRefreshToken = null;
	_googleTokenExpiry = 0;

	await Promise.all([
		deleteSecureItemAsync(SECURE_KEYS.googleAccessToken),
		deleteSecureItemAsync(SECURE_KEYS.googleRefreshToken),
		deleteSecureItemAsync(SECURE_KEYS.googleTokenExpiry),
	]);
	console.log("MCP auth: Google OAuth token cleared");
	emitAuthEvent("token_cleared");
}

/**
 * Try to refresh the Google access token via the server's /auth/refresh endpoint.
 * The server handles the client_id/secret — the client just sends the refresh_token.
 * Returns true if refresh succeeded.
 *
 * On failure: clears stale tokens and emits "needs_relogin" so the UI can
 * prompt the user to re-authenticate.
 */
export async function refreshGoogleToken(): Promise<boolean> {
  if (!_googleRefreshToken) {
    // No refresh token at all — clear stale state and signal re-login
    if (_googleAccessToken) {
      await clearMCPGoogleToken();
      emitAuthEvent("needs_relogin");
    }
    return false;
  }

  // Get server base URL
  const serverBase = MCP_SERVER_URL
    ? MCP_SERVER_URL.replace(/\/mcp\/?$/, "").replace(/\/$/, "")
    : "";
  if (!serverBase) {
    console.warn("MCP auth: no server URL for token refresh");
    await clearMCPGoogleToken();
    emitAuthEvent("needs_relogin");
    return false;
  }

  try {
    const res = await fetch(`${serverBase}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: _googleRefreshToken }),
    });

    if (!res.ok) {
      console.warn("MCP auth: token refresh failed:", res.status);
      await clearMCPGoogleToken();
      emitAuthEvent("needs_relogin");
      return false;
    }

    const data = await res.json();
    if (data.access_token) {
      await setMCPGoogleToken(
        data.access_token,
        data.expires_in || 3600,
        _googleRefreshToken || undefined
      );
      emitAuthEvent("token_refreshed");
      return true;
    }

    // Server returned 200 but no access_token — treat as failure
    console.warn("MCP auth: refresh response missing access_token");
    await clearMCPGoogleToken();
    emitAuthEvent("needs_relogin");
    return false;
  } catch (e: any) {
    console.warn("MCP auth: token refresh error:", e.message);
    await clearMCPGoogleToken();
    emitAuthEvent("needs_relogin");
    return false;
  }
}

// =============================================================================
// AUTH HEADERS
// =============================================================================

/**
 * Build auth headers for MCP server requests.
 * @param mcpUrl - The MCP endpoint URL. Used to determine auth strategy:
 *   - Travel MCP: sends X-API-Key header (static key from EXPO_PUBLIC_MCP_API_KEY)
 *   - Google MCP: sends Authorization: Bearer <OAuth token>
 */
async function getMCPAuthHeaders(mcpUrl?: string): Promise<Record<string, string>> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	const apiKey = (MCP_API_KEY || "").trim();
	const travelRoot = (MCP_TRAVEL_URL || "").trim().replace(/\/$/, "").replace(/\/mcp$/, "");
	const mcpRoot = (mcpUrl || "").replace(/\/$/, "").replace(/\/mcp$/, "");
	const isTravelUrl = !!mcpUrl && !!travelRoot && mcpRoot === travelRoot;

	// Travel MCP: static API key via X-API-Key header
	if (isTravelUrl && apiKey) {
		headers["X-API-Key"] = apiKey;
		return headers;
	}

	// Google MCP (OAuth): Authorization: Bearer <access_token>
	if (_googleAccessToken) {
		if (_googleTokenExpiry <= Date.now()) {
			const refreshed = await refreshGoogleToken();
			if (!refreshed) console.warn("MCP auth: OAuth token expired and refresh failed");
		}
		if (_googleAccessToken && _googleTokenExpiry > Date.now()) {
			headers["Authorization"] = `Bearer ${_googleAccessToken}`;
		}
	}

	return headers;
}

// =============================================================================
// URL HELPERS
// =============================================================================

/**
 * Normalize MCP URL. Travel MCP Python server exposes:
 *   - MCP endpoint at /mcp (FastMCP default)
 *   - Health at /health
 * Expects EXPO_PUBLIC_MCP_TRAVEL_URL as either:
 *   https://host/mcp  (full MCP endpoint) or
 *   https://host     (root; we append /mcp)
 */
function normalizeBaseUrl(url: string): { baseUrl: string; rootUrl?: string } {
	let baseUrl = url.replace(/\/$/, "");
	// If URL doesn't end with /mcp, append it (Travel MCP FastMCP default path)
	if (!baseUrl.endsWith("/mcp")) {
		baseUrl = `${baseUrl}/mcp`;
	}
	const rootUrl = baseUrl.replace(/\/mcp$/, "");
	return { baseUrl, rootUrl };
}

/** Configured MCP servers. Travel MCP (SerpAPI): flights & hotels. Google Workspace: Gmail/Calendar/Drive/Contacts. */
function getMcpServerUrls(): {
	baseUrl: string;
	name: string;
	rootUrl?: string;
}[] {
	const list: { baseUrl: string; name: string; rootUrl?: string }[] = [];
	const googleUrl = (MCP_GOOGLE_URL || "").trim();
	if (googleUrl) {
		const { baseUrl, rootUrl } = normalizeBaseUrl(googleUrl);
		list.push({ baseUrl, name: "google", rootUrl });
	}
	// Travel MCP (SerpAPI): flights & hotels only. Prefer your server (EXPO_PUBLIC_MCP_TRAVEL_URL); else hosted (EXPO_PUBLIC_SERPAPI_API_KEY).
	const travelUrl = (MCP_TRAVEL_URL || "").trim();
	const serpKey = (SERPAPI_API_KEY || "").trim();
	if (travelUrl) {
		const { baseUrl, rootUrl } = normalizeBaseUrl(travelUrl);
		list.push({ baseUrl, name: "travel", rootUrl });
	} else if (serpKey) {
		list.push({
			baseUrl: `https://mcp.serpapi.com/${encodeURIComponent(serpKey)}/mcp`,
			name: "travel",
		});
	}
	return list;
}

const MCP_SERVER_URL = MCP_GOOGLE_URL; // legacy / primary

// =============================================================================
// MCP PROTOCOL (JSON-RPC over HTTP / Streamable HTTP Transport)
// =============================================================================
// Travel, Kite, and other MCP servers speak the MCP protocol directly.
// We send JSON-RPC requests to the /mcp endpoint, not REST.

/** Session IDs per MCP endpoint (for session stickiness). */
const _mcpSessions: Record<string, string> = {};

/** Track which servers use MCP protocol vs REST. */
const _serverProtocol: Record<string, "rest" | "mcp"> = {};

/** Auto-incrementing JSON-RPC id. */
let _rpcId = 1;

/**
 * Parse a response that might be JSON or SSE (text/event-stream).
 * Returns the full JSON-RPC envelope { result?, error? } so mcpRpc can read .result / .error.
 */
async function parseMcpResponse(res: Response): Promise<{ result?: any; error?: any }> {
	const ct = res.headers.get("content-type") || "";

	if (ct.includes("text/event-stream")) {
		const text = await res.text();
		const lines = text.split("\n");
		for (const line of lines) {
			if (line.startsWith("data: ")) {
				try {
					const envelope = JSON.parse(line.slice(6).trim());
					return envelope;
				} catch {}
			}
		}
		throw new Error("No valid JSON-RPC message in SSE stream");
	}

	return res.json();
}

/**
 * Send a JSON-RPC request to an MCP endpoint.
 * Handles session tracking via Mcp-Session-Id header.
 * Auth headers are set per-server by getMCPAuthHeaders (X-API-Key for Travel, Bearer for Google).
 */
async function mcpRpc(
	mcpUrl: string,
	method: string,
	params?: any,
	isNotification = false,
): Promise<any> {
	const authHeaders = await getMCPAuthHeaders(mcpUrl);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
		...authHeaders,
	};

	// Attach session if we have one
	if (_mcpSessions[mcpUrl]) {
		headers["Mcp-Session-Id"] = _mcpSessions[mcpUrl];
	}

	const body: any = {
		jsonrpc: "2.0",
		method,
	};
	if (params !== undefined) body.params = params;
	if (!isNotification) body.id = _rpcId++;

	const res = await fetch(mcpUrl, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});

	// Capture session ID from response
	const sessionId = res.headers.get("mcp-session-id");
	if (sessionId) {
		_mcpSessions[mcpUrl] = sessionId;
	}

	if (isNotification) return null;

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`MCP RPC ${method} failed (${res.status}): ${text}`);
	}

	const data = await parseMcpResponse(res);
	if (data?.error) {
		throw new Error(
			`MCP RPC ${method} error: ${data.error.message || JSON.stringify(data.error)}`,
		);
	}
	return data?.result;
}

/**
 * Initialize an MCP session with a server.
 */
// MCP spec: https://modelcontextprotocol.io/specification/2024-11-05 — use 2024-11-05 for FastMCP/Travel/SerpAPI
const MCP_PROTOCOL_VERSION = "2024-11-05";

async function mcpInitialize(mcpUrl: string): Promise<void> {
	await mcpRpc(mcpUrl, "initialize", {
		protocolVersion: MCP_PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: { name: "agentcore", version: "1.0.0" },
	});
	// Send initialized notification
	await mcpRpc(mcpUrl, "notifications/initialized", {}, true);
}

/**
 * List tools from an MCP server via the MCP protocol.
 */
async function mcpListTools(mcpUrl: string): Promise<MCPTool[]> {
	// Initialize session if we don't have one
	if (!_mcpSessions[mcpUrl]) {
		await mcpInitialize(mcpUrl);
	}

	const result = await mcpRpc(mcpUrl, "tools/list");
	return (result?.tools ?? []) as MCPTool[];
}

/**
 * Call a tool on an MCP server via the MCP protocol.
 */
async function mcpCallTool(
	mcpUrl: string,
	toolName: string,
	args: Record<string, any>,
): Promise<MCPToolResult> {
	// Initialize session if we don't have one
	if (!_mcpSessions[mcpUrl]) {
		await mcpInitialize(mcpUrl);
	}

	const result = await mcpRpc(mcpUrl, "tools/call", {
		name: toolName,
		arguments: args,
	});

	// Result should be { content: [...], isError?: boolean }
	if (result?.content) return result;
	if (typeof result === "string") {
		return { content: [{ type: "text", text: result }] };
	}
	return {
		content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
	};
}

// =============================================================================
// TOOL ALIASES
// =============================================================================

const MINIMAL_TOOL_ALIASES: Record<string, string> = {
	gmail_read_message: "gmail_read_email",
	gmail_list_messages: "gmail_list_emails",
	gmail_search_messages: "gmail_list_emails",
	contacts_search_contacts: "contacts_search",
	contacts_list_contacts: "contacts_list",
	drive_search: "drive_search_files",
};

function normalizeToolName(toolName: string): string {
	const normalized = toolName.replace(/\./g, "_").replace(/^google_/, "");
	if (MINIMAL_TOOL_ALIASES[normalized]) {
		return MINIMAL_TOOL_ALIASES[normalized];
	}
	const validNames = currentSession?.tools?.map((t) => t.name) ?? [];
	if (validNames.length > 0 && validNames.includes(normalized)) {
		return normalized;
	}
	return normalized;
}

// =============================================================================
// TYPES
// =============================================================================

export interface MCPTool {
	name: string;
	description: string;
	inputSchema: {
		type: string;
		properties: Record<
			string,
			{
				type: string;
				description?: string;
				default?: any;
			}
		>;
		required?: string[];
	};
}

export interface MCPToolResult {
  content: {
    type: string;
    text?: string;
  }[];
  isError?: boolean;
}

interface MCPSession {
	sessionId: string;
	connected: boolean;
	tools: MCPTool[];
	toolToServer: Record<string, string>;
}

// =============================================================================
// SESSION STATE
// =============================================================================

let currentSession: MCPSession | null = null;
let toolToServerMap: Record<string, string> = {};

// =============================================================================
// FETCH TOOLS
// =============================================================================

/**
 * Fetch tools from a single MCP server.
 *
 * Both Google and Travel servers are FastMCP — try MCP protocol (JSON-RPC)
 * first. REST fallback (/api/tools) only applies to Google Workspace.
 *
 * baseUrl = full MCP endpoint (e.g. https://server.run.app/mcp)
 * rootUrl = server root (e.g. https://server.run.app)
 */
async function fetchToolsFromServer(
	baseUrl: string,
	rootUrl?: string,
	serverName?: string,
): Promise<{ tools: MCPTool[]; baseUrlForCalls: string }> {
	// --- Try MCP protocol (native FastMCP / Streamable HTTP) ---
	// Travel MCP and Google MCP both speak MCP protocol. Auth headers
	// (X-API-Key for Travel, Bearer token for Google) are set by getMCPAuthHeaders.
	try {
		const tools = await mcpListTools(baseUrl);
		if (tools.length > 0) {
			_serverProtocol[baseUrl] = "mcp";
			console.log(`MCP [${serverName}]: ${tools.length} tools via MCP protocol at ${baseUrl}`);
			return { tools, baseUrlForCalls: baseUrl };
		}
	} catch (e: any) {
		console.warn(`MCP [${serverName}] protocol failed for ${baseUrl}:`, e?.message);
	}

	// --- Fallback: REST custom routes (e.g. /api/tools) for Google Workspace ---
	// Travel MCP does NOT use REST; skip REST fallback for it.
	if (serverName !== "travel") {
		const headers = await getMCPAuthHeaders(baseUrl);
		const baseForRest = baseUrl.replace(/\/mcp$/, "");
		const bases = rootUrl ? [rootUrl, baseForRest] : [baseForRest];
		const paths = ["/api/tools", "/tools"];

		for (const base of bases) {
			for (const path of paths) {
				try {
					const url = `${base}${path}`;
					const res = await fetch(url, { method: "GET", headers });
					if (!res.ok) continue;
					const data = await res.json();
					const list = Array.isArray(data?.tools)
						? data.tools
						: Array.isArray(data)
							? data
							: [];
					if (list.length > 0) {
						_serverProtocol[base] = "rest";
						console.log(`MCP [${serverName}]: ${list.length} tools via REST at ${base}${path}`);
						return { tools: list as MCPTool[], baseUrlForCalls: base };
					}
				} catch {}
			}
		}
	}

	return { tools: [], baseUrlForCalls: baseUrl };
}

// =============================================================================
// INITIALIZE / LIST / CALL
// =============================================================================

/**
 * Initialize connection to one or more MCP servers and aggregate tools.
 */
export async function initializeMCPConnection(): Promise<MCPSession> {
	// Ensure persisted auth is loaded
	await loadPersistedAuth();

	const sessionId = `session-${Date.now()}`;
	const allTools: MCPTool[] = [];
	const toolToServer: Record<string, string> = {};
	const servers = getMcpServerUrls();

	for (const { baseUrl, name, rootUrl } of servers) {
		try {
			const { tools, baseUrlForCalls } = await fetchToolsFromServer(
				baseUrl,
				rootUrl,
				name,
			);
			for (const t of tools) {
				allTools.push(t);
				toolToServer[t.name] = baseUrlForCalls;
			}
			if (tools.length > 0) console.log(`MCP [${name}]: ${tools.length} tools`);
		} catch (e: any) {
			console.warn(`MCP [${name}] tools fetch failed:`, e?.message);
		}
	}

	if (allTools.length === 0) {
		throw new Error(
			"No MCP tools available from any server. Check server URLs and health.",
		);
	}

	toolToServerMap = toolToServer;
	currentSession = {
		sessionId,
		connected: true,
		tools: allTools,
		toolToServer,
	};
	console.log(
		`MCP session initialized with ${allTools.length} tools from ${servers.length} server(s) [auth: ${getMCPAuthMode()}]`,
	);
	return currentSession;
}

/**
 * List available tools from all configured MCP servers.
 */
export async function listMCPTools(): Promise<MCPTool[]> {
	await loadPersistedAuth();
	toolToServerMap = {};
	const allTools: MCPTool[] = [];
	const servers = getMcpServerUrls();

	for (const { baseUrl, name, rootUrl } of servers) {
		try {
			const { tools, baseUrlForCalls } = await fetchToolsFromServer(
				baseUrl,
				rootUrl,
				name,
			);
			for (const t of tools) {
				allTools.push(t);
				toolToServerMap[t.name] = baseUrlForCalls;
			}
			if (tools.length > 0) console.log(`MCP [${name}]: ${tools.length} tools`);
		} catch (e: any) {
			console.warn(`MCP [${name}] tools failed:`, e?.message);
		}
	}
	return allTools;
}

/**
 * Call an MCP tool; routes to the server that owns the tool.
 * Sends auth headers (OAuth token or API key) automatically.
 */
export async function callMCPTool(
	toolName: string,
	args: Record<string, any> = {},
): Promise<MCPToolResult> {
	try {
		const normalizedToolName = normalizeToolName(toolName);
		const baseUrl =
			toolToServerMap[normalizedToolName] ||
			(MCP_SERVER_URL ? MCP_SERVER_URL.replace(/\/$/, "") : "");

		if (!baseUrl) {
			return {
				content: [
					{
						type: "text",
						text: `No MCP server configured for tool: ${normalizedToolName}. Set EXPO_PUBLIC_MCP_SERVER_URL or connect MCP.`,
					},
				],
				isError: true,
			};
		}

		if (
			baseUrl.includes("localhost") ||
			baseUrl.startsWith("http://127.0.0.1")
		) {
			return {
				content: [
					{
						type: "text",
						text: `MCP is pointing at localhost (${baseUrl}). Set EXPO_PUBLIC_MCP_SERVER_URL to your deployed MCP URL.`,
					},
				],
				isError: true,
			};
		}

		console.log(
			`Calling MCP tool: ${normalizedToolName} @ ${baseUrl} [proto: ${_serverProtocol[baseUrl] || "rest"}, auth: ${getMCPAuthMode()}]`,
			args,
		);

		// ── MCP protocol path (Travel, Kite, etc.) ──
		if (_serverProtocol[baseUrl] === "mcp") {
			return await mcpCallTool(baseUrl, normalizedToolName, args);
		}

		// ── REST path (Google Workspace, etc.) ──
		// Google server exposes /api/call at root, not under /mcp — strip /mcp when building REST URLs
		const restBase = baseUrl.replace(/\/mcp\/?$/, "") || baseUrl;
		const headers = await getMCPAuthHeaders(baseUrl);
		const callUrls = [`${restBase}/api/call`, `${restBase}/call`];

		let response: Response | null = null;
		for (const url of callUrls) {
			const res = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify({ name: normalizedToolName, arguments: args }),
			});
			response = res;
			if (res.ok) break;

			// If 401, try token refresh and retry once
			if (res.status === 401) {
				if (_googleRefreshToken) {
					const refreshed = await refreshGoogleToken();
					if (refreshed) {
						const retryHeaders = await getMCPAuthHeaders();
						const retryRes = await fetch(url, {
							method: "POST",
							headers: retryHeaders,
							body: JSON.stringify({
								name: normalizedToolName,
								arguments: args,
							}),
						});
						response = retryRes;
						if (retryRes.ok) break;
					}
					// refreshGoogleToken already emits needs_relogin on failure
				} else {
					// No refresh token — clear stale state and signal re-login
					await clearMCPGoogleToken();
					emitAuthEvent("needs_relogin");
				}
			}
		}

		if (!response) {
			return {
				content: [
					{
						type: "text",
						text: `Error: No call endpoint responded for ${normalizedToolName}`,
					},
				],
				isError: true,
			};
		}

		let data: any;
		try {
			const text = await response.text();
			data = text ? (JSON.parse(text) as any) : {};
		} catch {
			return {
				content: [
					{
						type: "text",
						text: `Error: Server returned ${response.status} (${response.statusText}). Not valid JSON.`,
					},
				],
				isError: true,
			};
		}

		if (!response.ok) {
			return {
				content: [
					{
						type: "text",
						text: `Error: ${data.error || response.statusText}`,
					},
				],
				isError: true,
			};
		}

		if (data.error) {
			return {
				content: [{ type: "text", text: `Error: ${data.error}` }],
				isError: true,
			};
		}

		const result = data.result;
		if (typeof result === "string") {
			return { content: [{ type: "text", text: result }] };
		}
		if (result?.content) return result;
		return {
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
		};
	} catch (error: any) {
		console.error(`MCP tool call error for ${toolName}:`, error);
		return {
			content: [
				{ type: "text", text: `Error calling ${toolName}: ${error.message}` },
			],
			isError: true,
		};
	}
}

// =============================================================================
// GEMINI FUNCTION DECLARATIONS
// =============================================================================

export function mcpToolsToGeminiFunctions(tools: MCPTool[]): any[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: {
			type: "object",
			properties: Object.fromEntries(
				Object.entries(tool.inputSchema.properties || {}).map(
					([key, value]) => [
						key,
						{
							type: value.type === "number" ? "number" : "string",
							description: value.description || "",
						},
					],
				),
			),
			required: tool.inputSchema.required || [],
		},
	}));
}

// =============================================================================
// SESSION HELPERS
// =============================================================================

export function getMCPSession(): MCPSession | null {
	return currentSession;
}

export function isMCPConnected(): boolean {
	return currentSession?.connected || false;
}

export function getMCPServerURL(): string {
	return MCP_SERVER_URL;
}

/** Travel MCP base URL if configured (for Market UI). */
export function getTravelServerURL(): string {
	return MCP_TRAVEL_URL;
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

export async function checkMCPHealth(): Promise<{
	healthy: boolean;
	status?: any;
	error?: string;
}> {
	const servers = getMcpServerUrls();
	const timeoutMs = 5000;

	for (const { baseUrl, name, rootUrl } of servers) {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
		const healthBases = rootUrl ? [rootUrl, baseUrl] : [baseUrl];

		for (const base of healthBases) {
			try {
				const healthUrl = `${base}/health`;
				const headers = await getMCPAuthHeaders(baseUrl);
				const response = await fetch(healthUrl, {
					method: "GET",
					headers,
					signal: controller.signal,
				});
				clearTimeout(timeoutId);
				if (response.ok) {
					const data = await response.json().catch(() => ({}));
					return {
						healthy: true,
						status: { server: name, auth: getMCPAuthMode(), ...data },
					};
				}
			} catch (e: any) {
				if (e?.name === "AbortError") break;
			}
		}
		clearTimeout(timeoutId);
	}

	return {
		healthy: false,
		error:
			"No MCP server responded (tried " +
			servers.map((s) => s.name).join(", ") +
			")",
	};
}

// =============================================================================
// REINITIALIZE
// =============================================================================

export async function reinitializeMCP(): Promise<boolean> {
	currentSession = null;
	try {
		await initializeMCPConnection();
		return true;
	} catch {
		return false;
	}
}

// OAuth scopes and client ID are now handled server-side (OAuth proxy).
