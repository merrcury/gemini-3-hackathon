import {
	deleteSecureItemAsync,
	getSecureItemAsync,
	setSecureItemAsync,
} from "./secure-storage";

const JWT_STORAGE_KEY = "clerk_jwt_token";
const JWT_EXPIRY_KEY = "clerk_jwt_expiry";

/** Clerk JWT template name used for backend APIs (create this template in Clerk Dashboard). */
export const CLERK_JWT_TEMPLATE = "second-brain-jwt";

/**
 * Refresh buffer — stop using a cached token this many seconds BEFORE its real
 * `exp` timestamp so we never send an almost-expired token to the backend.
 */
const EXPIRY_BUFFER_SEC = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode the payload of a JWT **without** verifying the signature.
 * We only need to read `exp` so we know when to refresh.
 */
function decodeJWTPayload(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		// Base64url → Base64 → decode
		const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const json = atob(base64);
		return JSON.parse(json);
	} catch {
		return null;
	}
}

/**
 * Read the `exp` claim (seconds since epoch) from a JWT.
 * Returns a millisecond timestamp, or null if unreadable.
 */
function getJWTExpiry(token: string): number | null {
	const payload = decodeJWTPayload(token);
	if (!payload || typeof payload.exp !== "number") return null;
	return payload.exp * 1000; // seconds → ms
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Get JWT token from Clerk session and store it securely.
 * Uses the "second-brain-jwt" template by default.
 *
 * The token's actual `exp` claim is read and stored so we never serve
 * a token the backend will reject as expired.
 */
export async function getClerkJWT(
	getToken: (options?: { template?: string }) => Promise<string | null>,
	template: string = CLERK_JWT_TEMPLATE,
): Promise<string | null> {
	try {
		const token = await getToken({ template });

		if (!token) {
			console.warn("No JWT token available from Clerk");
			return null;
		}

		// Store token in secure storage
		await setSecureItemAsync(JWT_STORAGE_KEY, token);

		// Read the real expiry from the JWT payload
		const realExpiry = getJWTExpiry(token);
		const expiryTime = realExpiry
			? realExpiry - EXPIRY_BUFFER_SEC * 1000 // refresh 10s before actual expiry
			: Date.now() + 50 * 1000; // fallback: 50s (Clerk default is 60s)

		await setSecureItemAsync(JWT_EXPIRY_KEY, expiryTime.toString());

		const ttlSec = Math.round((expiryTime - Date.now()) / 1000);
		console.log(`JWT token stored (expires in ~${ttlSec}s)`);
		return token;
	} catch (error) {
		console.error("Error getting JWT from Clerk:", error);
		return null;
	}
}

/**
 * Retrieve stored JWT token from SecureStore.
 * Returns null if the token is missing or has expired (based on real `exp`).
 */
export async function getStoredJWT(): Promise<string | null> {
	try {
		const expiryStr = await getSecureItemAsync(JWT_EXPIRY_KEY);
		if (expiryStr) {
			const expiryTime = parseInt(expiryStr, 10);
			if (Date.now() >= expiryTime) {
				// Token has expired — clear and return null so caller fetches fresh
				await clearStoredJWT();
				return null;
			}
		}

		const token = await getSecureItemAsync(JWT_STORAGE_KEY);
		return token;
	} catch (error) {
		console.error("Error retrieving stored JWT:", error);
		return null;
	}
}

/**
 * Clear stored JWT token and expiry.
 */
export async function clearStoredJWT(): Promise<void> {
	try {
		await deleteSecureItemAsync(JWT_STORAGE_KEY);
		await deleteSecureItemAsync(JWT_EXPIRY_KEY);
	} catch (error) {
		console.error("Error clearing JWT:", error);
	}
}

/**
 * Get or refresh JWT token.
 * Returns the cached token if still valid, otherwise fetches a new one from Clerk.
 */
export async function getOrRefreshJWT(
	getToken: (options?: { template?: string }) => Promise<string | null>,
	template: string = CLERK_JWT_TEMPLATE,
): Promise<string | null> {
	const storedToken = await getStoredJWT();
	if (storedToken) {
		return storedToken;
	}
	// Stored token missing or expired → get a fresh one from Clerk
	return await getClerkJWT(getToken, template);
}

/**
 * Force a fresh JWT from Clerk, bypassing the stored cache.
 * Use this when a 401 indicates the stored token is stale/invalid,
 * or on critical paths (brain init) where you want a guaranteed-fresh token.
 */
export async function forceNewJWT(
	getToken: (options?: { template?: string }) => Promise<string | null>,
	template: string = CLERK_JWT_TEMPLATE,
): Promise<string | null> {
	await clearStoredJWT();
	return await getClerkJWT(getToken, template);
}

/**
 * Get JWT token for use in API requests as Bearer token.
 */
export async function getAuthBearerToken(
	getToken: (options?: { template?: string }) => Promise<string | null>,
	template: string = CLERK_JWT_TEMPLATE,
): Promise<string | null> {
	return await getOrRefreshJWT(getToken, template);
}
