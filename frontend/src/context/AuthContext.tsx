import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient, ApiError } from '@/lib/api';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  role: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, fullName: string, password: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  fetchProfile: () => Promise<UserProfile>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('access_token'));
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  const fetchProfile = useCallback(async (): Promise<UserProfile> => {
    try {
      const profile = await apiClient.get<UserProfile>('/api/v1/auth/me');
      setUser(profile);
      return profile;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
      }
      throw err;
    }
  }, [logout]);

  useEffect(() => {
    let isMounted = true;
    async function restoreSession() {
      const storedToken = localStorage.getItem('access_token');
      if (storedToken) {
        try {
          const profile = await apiClient.get<UserProfile>('/api/v1/auth/me');
          if (isMounted) {
            setUser(profile);
          }
        } catch (err) {
          if (isMounted) {
            if (err instanceof ApiError && (err.status === 503 || err.status === 502 || err.status === 504)) {
              setError('Server unavailable');
            } else {
              localStorage.removeItem('access_token');
              setToken(null);
            }
            setUser(null);
          }
        }
      }
      if (isMounted) {
        setIsLoading(false);
      }
    }
    restoreSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.post<TokenResponse>('/api/v1/auth/login', {
        email,
        password,
      });
      localStorage.setItem('access_token', res.access_token);
      setToken(res.access_token);
      const profile = await apiClient.get<UserProfile>('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${res.access_token}` },
      });
      setUser(profile);
    } catch (err) {
      let message = 'Login failed. Please check your credentials.';
      if (err instanceof ApiError) {
        if (err.status === 503 || err.status === 502 || err.status === 504) {
          message = 'Server unavailable';
        } else if (err.status === 401) {
          message = err.message || 'Invalid email or password';
        } else {
          message = err.message || message;
        }
      } else if (err instanceof TypeError || (err instanceof Error && err.message.toLowerCase().includes('fetch'))) {
        message = 'Server unavailable';
      }
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (email: string, fullName: string, password: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      await apiClient.post<UserProfile>('/api/v1/auth/register', {
        email,
        full_name: fullName,
        password,
      });
      await login(email, password);
    } catch (err) {
      let message = 'Registration failed. Please try again.';
      if (err instanceof ApiError) {
        if (err.status === 503 || err.status === 502 || err.status === 504) {
          message = 'Server unavailable';
        } else if (err.status === 409) {
          message = err.message || 'A user with this email address already exists.';
        } else {
          message = err.message || message;
        }
      } else if (err instanceof TypeError || (err instanceof Error && err.message.toLowerCase().includes('fetch'))) {
        message = 'Server unavailable';
      }
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        error,
        login,
        register,
        logout,
        clearError,
        fetchProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
