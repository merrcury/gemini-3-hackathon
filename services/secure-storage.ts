/**
 * Cross-platform secure storage: uses expo-secure-store on native (iOS/Android)
 * and falls back to in-memory + localStorage on web, where the native module
 * is not available (ExpoSecureStore.default.setValueWithKeyAsync is not a function).
 */

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const FALLBACK_PREFIX = "@secure_";
const memoryFallback: Record<string, string> = {};

function isWeb(): boolean {
  if (typeof Platform !== "undefined" && Platform.OS === "web") return true;
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isSecureStoreError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("setValueWithKeyAsync") ||
    msg.includes("getValueWithKeyAsync") ||
    msg.includes("deleteValueWithKeyAsync") ||
    msg.includes("is not a function")
  );
}

async function getFallback(key: string): Promise<string | null> {
  if (memoryFallback[key] != null) return memoryFallback[key];
  if (typeof localStorage !== "undefined") {
    return localStorage.getItem(FALLBACK_PREFIX + key);
  }
  return null;
}

async function setFallback(key: string, value: string): Promise<void> {
  memoryFallback[key] = value;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(FALLBACK_PREFIX + key, value);
  }
}

async function deleteFallback(key: string): Promise<void> {
  delete memoryFallback[key];
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(FALLBACK_PREFIX + key);
  }
}

/**
 * Get item: uses SecureStore on native; fallback on web or if native module is missing.
 */
export async function getSecureItemAsync(key: string): Promise<string | null> {
  if (isWeb()) {
    return getFallback(key);
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch (e) {
    if (isSecureStoreError(e)) {
      return getFallback(key);
    }
    throw e;
  }
}

/**
 * Set item: uses SecureStore on native; fallback on web or if native module is missing.
 */
export async function setSecureItemAsync(key: string, value: string): Promise<void> {
  if (isWeb()) {
    await setFallback(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (e) {
    if (isSecureStoreError(e)) {
      await setFallback(key, value);
      return;
    }
    throw e;
  }
}

/**
 * Delete item: uses SecureStore on native; fallback on web or if native module is missing.
 * Catches all errors (including deleteValueWithKeyAsync not a function on web) and falls back so callers never throw.
 */
export async function deleteSecureItemAsync(key: string): Promise<void> {
  if (isWeb()) {
    await deleteFallback(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (e) {
    if (isSecureStoreError(e)) {
      await deleteFallback(key);
      return;
    }
    // On any other error (e.g. native module unavailable), fall back so 401 handler doesn't crash
    await deleteFallback(key);
  }
}
