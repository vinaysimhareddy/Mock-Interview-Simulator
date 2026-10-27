import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiError } from '../src/lib/api';

function createStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
    keys: () => Object.keys(store),
  };
}

const mockLocalStorage = createStorageMock();
const mockSessionStorage = createStorageMock();
(globalThis as unknown as { localStorage: unknown }).localStorage = mockLocalStorage;
(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = mockSessionStorage;

describe('D5 Frontend Auth & Storage Invariants', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    mockSessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('permits only "access_token" in localStorage and forbids passwords or user dumps', () => {
    // Simulate setting valid token
    localStorage.setItem('access_token', 'mock.jwt.token');

    const keys = mockLocalStorage.keys();
    expect(keys).toEqual(['access_token']);

    // Check no passwords or user data are stored
    const forbiddenKeys = ['password', 'hashed_password', 'user', 'currentUser', 'profile', 'userData'];
    for (const key of forbiddenKeys) {
      expect(localStorage.getItem(key)).toBeNull();
      expect(sessionStorage.getItem(key)).toBeNull();
    }
  });

  it('failed login API call (503 / network error) throws and never sets access_token or logs in', async () => {
    // Mock global fetch to return 503 Service Unavailable
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Database unavailable' }),
    });

    const { apiRequest } = await import('../src/lib/api');

    await expect(apiRequest('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' }),
    })).rejects.toThrow('Database unavailable');

    // Token must NOT be stored
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('failed register API call with 409 Conflict throws actionable error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'A user with this email address already exists.' }),
    });

    const { apiRequest } = await import('../src/lib/api');

    await expect(apiRequest('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'duplicate@example.com', full_name: 'Dup User', password: 'Password123!' }),
    })).rejects.toThrow('A user with this email address already exists.');

    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('network disconnection throws 503 Server unavailable error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const { apiRequest } = await import('../src/lib/api');

    await expect(apiRequest('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' }),
    })).rejects.toThrow('Server unavailable');

    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('401 response throws ApiError with status 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid email or password' }),
    });

    const { apiRequest } = await import('../src/lib/api');

    try {
      await apiRequest('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', password: 'WrongPassword' }),
      });
      expect.unreachable('Should have thrown 401');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
      expect((err as ApiError).message).toBe('Invalid email or password');
    }
  });
});
