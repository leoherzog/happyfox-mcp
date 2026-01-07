import { HappyFoxAuth } from '../types';

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: any;
  queryParams?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
}

export class HappyFoxClient {
  private baseUrl: string;
  private auth: HappyFoxAuth;
  private maxRetries = 5;
  private baseDelay = 1000; // Start with 1 second
  private maxDelay = 60000; // Cap at 60 seconds

  constructor(auth: HappyFoxAuth) {
    this.auth = auth;
    const domain = auth.region === 'eu' ? 'happyfox.net' : 'happyfox.com';
    this.baseUrl = `https://${auth.accountName}.${domain}/api/1.1/json`;
  }

  async makeRequest<T = any>(options: RequestOptions, retryCount = 0): Promise<T> {
    const { method, path, body, queryParams, headers = {} } = options;

    let url = `${this.baseUrl}${path}`;
    if (queryParams) {
      const params = new URLSearchParams();
      Object.entries(queryParams).forEach(([key, value]) => {
        params.append(key, String(value));
      });
      url += `?${params.toString()}`;
    }

    const authHeader = `Basic ${btoa(`${this.auth.apiKey}:${this.auth.authCode}`)}`;

    const requestHeaders: Record<string, string> = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      ...headers
    };

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined
      });

      // Handle rate limiting with exponential backoff
      if (response.status === 429) {
        if (retryCount >= this.maxRetries) {
          throw new HappyFoxAPIError(
            'Rate limit exceeded after maximum retries',
            429,
            'RATE_LIMIT_EXCEEDED'
          );
        }

        // Calculate exponential backoff delay with jitter
        const jitter = Math.random() * 1000;
        const delay = Math.min(
          this.baseDelay * Math.pow(2, retryCount) + jitter,
          this.maxDelay
        );

        console.warn(`Rate limited. Retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${this.maxRetries})`);

        // Wait and retry
        await this.sleep(delay);
        return this.makeRequest<T>(options, retryCount + 1);
      }

      // Handle other error responses
      if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage = `HappyFox API error: ${response.status} ${response.statusText}`;

        try {
          const errorJson = JSON.parse(errorBody);
          if (errorJson.error) {
            errorMessage = errorJson.error;
          } else if (errorJson.message) {
            errorMessage = errorJson.message;
          }
        } catch {
          // If not JSON, use the text as is
          if (errorBody) {
            errorMessage = errorBody;
          }
        }

        throw new HappyFoxAPIError(errorMessage, response.status, 'API_ERROR');
      }

      // Parse successful response
      const responseText = await response.text();
      if (!responseText) {
        return {} as T;
      }

      try {
        return JSON.parse(responseText);
      } catch {
        // Some endpoints might return non-JSON responses
        return responseText as unknown as T;
      }
    } catch (error) {
      // Retry on network errors
      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        const delay = Math.min(
          this.baseDelay * Math.pow(2, retryCount),
          this.maxDelay
        );

        console.warn(`Network error. Retrying in ${Math.round(delay)}ms (attempt ${retryCount + 1}/${this.maxRetries})`);

        await this.sleep(delay);
        return this.makeRequest<T>(options, retryCount + 1);
      }

      // Re-throw if not retryable or max retries reached
      if (error instanceof HappyFoxAPIError) {
        throw error;
      }

      throw new HappyFoxAPIError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`,
        0,
        'NETWORK_ERROR'
      );
    }
  }

  private isRetryableError(error: any): boolean {
    // Retry on network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return true;
    }

    // Retry on specific error codes
    if (error.code) {
      const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'];
      return retryableCodes.includes(error.code);
    }

    // Retry on 5xx errors (server errors)
    if (error instanceof HappyFoxAPIError) {
      return error.statusCode >= 500 && error.statusCode < 600;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Convenience methods for common HTTP methods
  async get<T = any>(path: string, queryParams?: Record<string, string | number | boolean>): Promise<T> {
    return this.makeRequest<T>({ method: 'GET', path, queryParams });
  }

  async post<T = any>(path: string, body?: any, queryParams?: Record<string, string | number | boolean>): Promise<T> {
    return this.makeRequest<T>({ method: 'POST', path, body, queryParams });
  }

  async put<T = any>(path: string, body?: any, queryParams?: Record<string, string | number | boolean>): Promise<T> {
    return this.makeRequest<T>({ method: 'PUT', path, body, queryParams });
  }

  async delete<T = any>(path: string, queryParams?: Record<string, string | number | boolean>): Promise<T> {
    return this.makeRequest<T>({ method: 'DELETE', path, queryParams });
  }
}

export class HappyFoxAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string
  ) {
    super(message);
    this.name = 'HappyFoxAPIError';
  }
}