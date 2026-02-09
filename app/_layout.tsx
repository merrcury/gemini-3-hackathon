// app/_layout.tsx
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from "expo-constants";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { CLERK_JWT_TEMPLATE } from '../services/jwt';
import { getPreferences } from "../services/preferences";
import { getSecureItemAsync, setSecureItemAsync } from '../services/secure-storage';

const CLERK_PUBLISHABLE_KEY =
  Constants.expoConfig?.extra?.clerkPublishableKey ||
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const LOAD_TIMEOUT_MS = 10000; // Stop blocking after 10s so we never stay "stuck at fetching"

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error("Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env file");
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard: only call the preferences API once per mount to avoid 401 spam
  const prefsCheckedRef = useRef(false);

  // Prevent infinite loading: after LOAD_TIMEOUT_MS, render app anyway
  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      setLoadTimedOut(true);
      setIsCheckingOnboarding(false);
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    const checkAuthAndOnboarding = async () => {
      setIsCheckingOnboarding(true);
      try {
        // Check if we have any segments (app might be in initial load state)
        // Use type assertion to bypass TypeScript's strict length check
        const currentSegments = segments as string[];
        
        // User is NOT signed in
        if (!isSignedIn) {
          // Only redirect if we're not on auth page
          if (currentSegments[0] !== "auth") {
            router.replace("/auth");
          }
          setIsCheckingOnboarding(false);
          return;
        }

        // User IS signed in — only show onboarding for new users
        let hasCompletedOnboarding = (await AsyncStorage.getItem('userProfile')) != null;
        const firstSegment = currentSegments[0];
        const isAlreadyOnOnboarding =
          firstSegment === "onboarding" ||
          (firstSegment === "(tabs)" && currentSegments[1] === "onboarding");

        // Only call preferences API ONCE per mount to avoid 401 spam on segment changes
        if (!hasCompletedOnboarding && getToken && !isAlreadyOnOnboarding && !prefsCheckedRef.current) {
          prefsCheckedRef.current = true;
          try {
            // Always get a fresh JWT from Clerk (not stored cache)
            const token = await getToken({ template: CLERK_JWT_TEMPLATE });
            if (!token) throw new Error('No JWT from Clerk');
            const prefs = await getPreferences(token);
            const hasProfileOnServer = !!(prefs?.preferredName ?? prefs?.name ?? prefs?.bio);
            if (hasProfileOnServer) {
              hasCompletedOnboarding = true;
              await AsyncStorage.setItem('userProfile', JSON.stringify({ fromServer: true }));
            }
          } catch (_firstErr) {
            // First attempt failed (401 or network) — retry once with a brand-new Clerk token
            try {
              const retryToken = await getToken({ template: CLERK_JWT_TEMPLATE });
              if (retryToken) {
                const prefs = await getPreferences(retryToken);
                const hasProfileOnServer = !!(prefs?.preferredName ?? prefs?.name ?? prefs?.bio);
                if (hasProfileOnServer) {
                  hasCompletedOnboarding = true;
                  await AsyncStorage.setItem('userProfile', JSON.stringify({ fromServer: true }));
                }
              }
            } catch (_) {
              // Both attempts failed — don't force onboarding, let user into chat.
              // They can always access onboarding from profile later.
              // This prevents the loop: sign-in → auth error → onboarding → auth error → stuck
              hasCompletedOnboarding = true;
              await AsyncStorage.setItem('userProfile', JSON.stringify({ pendingOnboarding: true })).catch(() => {});
              console.warn('Preferences check failed after retry; skipping onboarding to avoid loop');
            }
          }
        }

        // Determine if we need to redirect — if so, keep the loader showing
        // until the redirect completes (the segment change will re-trigger this effect)
        let needsRedirect = false;

        // Handle initial app load (no segments)
        if (!firstSegment) {
          needsRedirect = true;
          if (!hasCompletedOnboarding) {
            router.replace("/(tabs)/onboarding");
          } else {
            router.replace("/(tabs)/chat");
          }
        } else {
          // Check where user is trying to go
          switch (firstSegment) {
            case "auth":
              needsRedirect = true;
              if (hasCompletedOnboarding) {
                router.replace("/(tabs)/chat");
              } else {
                router.replace("/(tabs)/onboarding");
              }
              break;
            case "onboarding":
              if (hasCompletedOnboarding) {
                needsRedirect = true;
                router.replace("/(tabs)/chat");
              }
              // else: already on onboarding, no redirect needed
              break;
            case "(tabs)":
              if (!hasCompletedOnboarding && !isAlreadyOnOnboarding) {
                needsRedirect = true;
                router.replace("/(tabs)/onboarding");
              }
              break;
            default:
              if (!hasCompletedOnboarding && !isAlreadyOnOnboarding) {
                needsRedirect = true;
                router.replace("/(tabs)/onboarding");
              }
              break;
          }
        }

        // Only dismiss the loader when we're on the correct page already.
        // If we redirected, keep the loader up — the segment change from
        // router.replace() will re-trigger this effect, and on the next run
        // the user will be on the right page → no redirect → loader dismissed.
        if (!needsRedirect) {
          setIsCheckingOnboarding(false);
        }
        
      } catch (error) {
        console.error('Error checking onboarding:', error);
        setIsCheckingOnboarding(false);
      }
    };

    checkAuthAndOnboarding();
  }, [isSignedIn, segments, isLoaded]);

  const showLoader = !loadTimedOut && (!isLoaded || isCheckingOnboarding);
  if (showLoader) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0B1220" }}>
        <ActivityIndicator size="large" color="#00E5FF" />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <ClerkProvider 
      publishableKey={CLERK_PUBLISHABLE_KEY}
      tokenCache={{
        async getToken(key: string) {
          try {
            return await getSecureItemAsync(key);
          } catch (error) {
            console.error('Error getting token:', error);
            return null;
          }
        },
        async saveToken(key: string, token: string) {
          try {
            await setSecureItemAsync(key, token);
          } catch (error) {
            console.error('Error saving token:', error);
          }
        },
      }}
    >
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="auth" />
          <Stack.Screen name="onboarding" />
        </Stack>
      </AuthProvider>
    </ClerkProvider>
  );
}