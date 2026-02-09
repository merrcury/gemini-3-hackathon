import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_URL =
  Constants.expoConfig?.extra?.apiUrl || process.env.API_URL || "";

const JWT_STORAGE_KEY = "@chat_jwt_token";
const USER_ID_STORAGE_KEY = "@chat_user_id";

export interface Message {
  text: string;
  role: "user" | "assistant";
  timestamp?: number;
}

export interface Conversation {
  id: string;
  user_id: string;
  messages: Message[];
  created_at?: string;
  updated_at?: string;
}

/**
 * Get JWT token from storage
 */
export async function getJWTToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(JWT_STORAGE_KEY);
  } catch (error) {
    console.error("Error getting JWT token:", error);
    return null;
  }
}

/**
 * Save JWT token to storage
 */
export async function saveJWTToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(JWT_STORAGE_KEY, token);
  } catch (error) {
    console.error("Error saving JWT token:", error);
  }
}

/**
 * Get user ID from storage
 */
export async function getUserId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(USER_ID_STORAGE_KEY);
  } catch (error) {
    console.error("Error getting user ID:", error);
    return null;
  }
}

/**
 * Save user ID to storage
 */
export async function saveUserId(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_ID_STORAGE_KEY, userId);
  } catch (error) {
    console.error("Error saving user ID:", error);
  }
}

/**
 * Get authorization headers with JWT token
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getJWTToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
import { getAuthBearerToken } from './jwt';
import { useAuth } from '@clerk/clerk-expo';

/**
 * API service with JWT authentication
 * This service automatically includes the JWT bearer token in requests
 */

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080';

/**
 * Get authorization headers with JWT token
 * @param getToken - Clerk's getToken function from useAuth hook
 * @returns Headers object with Authorization bearer token
 */
export async function getAuthHeaders(
  getToken: (options?: { template?: string }) => Promise<string | null>
): Promise<HeadersInit> {
  const token = await getAuthBearerToken(getToken);
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Get latest conversation for current user
 */
export async function getLatestConversation(): Promise<Conversation | null> {
  if (!API_URL) {
    console.warn("API_URL not configured");
    return null;
  }

  try {
    const userId = await getUserId();
    if (!userId) {
      console.warn("User ID not found");
      return null;
    }

    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/conversations/${userId}/latest`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null; // No conversation found
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching latest conversation:", error);
    return null;
  }
}

/**
 * Get all conversations for current user
 */
export async function getAllConversations(): Promise<Conversation[]> {
  if (!API_URL) {
    console.warn("API_URL not configured");
    return [];
  }

  try {
    const userId = await getUserId();
    if (!userId) {
      console.warn("User ID not found");
      return [];
    }

    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/conversations/${userId}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return [];
  }
}

/**
 * Add a message to the conversation
 */
export async function addMessage(
  message: Message
): Promise<{ success: boolean; conversation_id: string }> {
  if (!API_URL) {
    throw new Error("API_URL not configured");
  }

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || `HTTP error! status: ${response.status}`
      );
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    console.error("Error adding message:", error);
    throw error;
  }
}

/**
 * Update conversation with all messages
 */
export async function updateConversationMessages(
  conversationId: string,
  messages: Message[]
): Promise<{ success: boolean; messages_count: number }> {
  if (!API_URL) {
    throw new Error("API_URL not configured");
  }

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(
      `${API_URL}/api/conversations/${conversationId}/messages`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify(messages),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || `HTTP error! status: ${response.status}`
      );
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    console.error("Error updating conversation:", error);
    throw error;
  }
}

/**
 * Create a new conversation
 */
export async function createConversation(
  messages: Message[]
): Promise<Conversation> {
  if (!API_URL) {
    throw new Error("API_URL not configured");
  }

  try {
    const userId = await getUserId();
    if (!userId) {
      throw new Error("User ID not found");
    }

    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/conversations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id: userId,
        messages: messages,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || `HTTP error! status: ${response.status}`
      );
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    console.error("Error creating conversation:", error);
    throw error;
  }
 * Make an authenticated API request
 * @param endpoint - API endpoint (relative to base URL)
 * @param options - Fetch options
 * @param getToken - Clerk's getToken function from useAuth hook
 * @returns Response data
 */
export async function authenticatedFetch(
  endpoint: string,
  options: RequestInit = {},
  getToken: (options?: { template?: string }) => Promise<string | null>
): Promise<Response> {
  const headers = await getAuthHeaders(getToken);
  
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message || errorData.detail || `HTTP error! status: ${response.status}`
    );
  }

  return response;
}

/**
 * Example: Get user profile
 */
export async function getUserProfile(
  getToken: (options?: { template?: string }) => Promise<string | null>
) {
  const response = await authenticatedFetch('/api/user/profile', {
    method: 'GET',
  }, getToken);
  return response.json();
}

/**
 * Example: Update user profile
 */
export async function updateUserProfile(
  data: any,
  getToken: (options?: { template?: string }) => Promise<string | null>
) {
  const response = await authenticatedFetch('/api/user/profile', {
    method: 'PUT',
    body: JSON.stringify(data),
  }, getToken);
  return response.json();
}
