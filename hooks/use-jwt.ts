import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-expo';
import { getOrRefreshJWT, getStoredJWT, clearStoredJWT, CLERK_JWT_TEMPLATE } from '@/services/jwt';

/**
 * React hook to get and manage JWT token from Clerk session
 * @param template - JWT template name (default: second-brain-jwt)
 * @returns Object with jwt token, loading state, and error
 */
export function useJWT(template: string = CLERK_JWT_TEMPLATE) {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const [jwt, setJwt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!isSignedIn) {
      // Clear JWT if user is signed out
      clearStoredJWT().then(() => {
        setJwt(null);
        setIsLoading(false);
      });
      return;
    }

    // Load JWT token
    const loadJWT = async () => {
      setIsLoading(true);
      setError(null);

      try {
        if (!getToken) {
          throw new Error('getToken function not available');
        }

        const token = await getOrRefreshJWT(getToken, template);
        setJwt(token);
      } catch (err: any) {
        console.error('Error loading JWT:', err);
        setError(err.message || 'Failed to load JWT token');
        setJwt(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadJWT();
  }, [isSignedIn, isLoaded, getToken, template]);

  /**
   * Manually refresh the JWT token
   */
  const refreshJWT = async () => {
    if (!isSignedIn || !getToken) {
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = await getOrRefreshJWT(getToken, template);
      setJwt(token);
      return token;
    } catch (err: any) {
      console.error('Error refreshing JWT:', err);
      setError(err.message || 'Failed to refresh JWT token');
      setJwt(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    jwt,
    isLoading,
    error,
    refreshJWT,
    isAuthenticated: isSignedIn && !!jwt,
  };
}

/**
 * Simple hook to get JWT token as a bearer token string
 * Returns the token ready to use in Authorization header
 */
export function useBearerToken(template: string = CLERK_JWT_TEMPLATE) {
  const { jwt, isLoading } = useJWT(template);
  return {
    bearerToken: jwt ? `Bearer ${jwt}` : null,
    token: jwt,
    isLoading,
  };
}
