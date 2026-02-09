// utils/cache.ts (simpler version)
import { getSecureItemAsync, setSecureItemAsync } from '../../services/secure-storage';

const createTokenCache = () => {
  return {
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
  };
};

export const tokenCache = createTokenCache();