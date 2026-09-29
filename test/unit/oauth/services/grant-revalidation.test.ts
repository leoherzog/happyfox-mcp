import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { GrantType, OAuthError } from '@cloudflare/workers-oauth-provider';
import type { TokenExchangeCallbackOptions } from '@cloudflare/workers-oauth-provider';
import { revalidateOnRefresh } from '../../../../src/oauth/services/grant-revalidation';
import { CredentialStore } from '../../../../src/oauth/services/credential-store';
import { CREDENTIAL_TTL_SECONDS, StoredCredentials } from '../../../../src/oauth/types';
import { fetchMock } from '../../../helpers/fetch-mock';
import {
  resetFetchMock,
  mockHappyFoxGet,
  lastHappyFoxRequest,
  sentHappyFoxRequests,
} from '../../../helpers/fetch-mock-helpers';

const TOKEN_ID = 'revalidation-token';

function credentials(overrides: Partial<StoredCredentials> = {}): StoredCredentials {
  return {
    apiKey: 'test-api-key',
    authCode: 'test-auth-code',
    accountName: 'testaccount',
    region: 'us',
    staffId: 14,
    staffName: 'George',
    staffEmail: 'george@happyfox-test.com',
    expiresAt: Math.floor(Date.now() / 1000) + CREDENTIAL_TTL_SECONDS,
    ...overrides,
  };
}

function options(grantType: GrantType, props: unknown = { tokenId: TOKEN_ID, scopes: ['happyfox:read'] }): TokenExchangeCallbackOptions {
  return {
    grantType,
    clientId: 'client',
    userId: TOKEN_ID,
    grantId: 'grant',
    scope: ['happyfox:read'],
    requestedScope: ['happyfox:read'],
    props,
  };
}

async function refusal(promise: Promise<unknown>): Promise<OAuthError> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(OAuthError);
  return error as OAuthError;
}

describe('revalidateOnRefresh', () => {
  const store = new CredentialStore(env.OAUTH_KV, env.CREDENTIAL_ENCRYPTION_KEY);

  beforeEach(async () => {
    resetFetchMock();
    await store.store(TOKEN_ID, credentials());
  });

  it('does nothing for the authorization-code exchange', async () => {
    await expect(revalidateOnRefresh(options(GrantType.AUTHORIZATION_CODE), env)).resolves.toBeUndefined();
    expect(sentHappyFoxRequests()).toHaveLength(0);
  });

  it('lets the refresh through while the agent is active, reading GET /staff/ once', async () => {
    mockHappyFoxGet('/staff/', [{ id: 14, name: 'George', email: 'george@happyfox-test.com', active: true }]);

    await expect(revalidateOnRefresh(options(GrantType.REFRESH_TOKEN), env)).resolves.toBeUndefined();

    expect(sentHappyFoxRequests()).toHaveLength(1);
    expect(lastHappyFoxRequest().method).toBe('GET');
    expect(lastHappyFoxRequest().apiPath).toBe('/staff/');
    expect(await store.retrieve(TOKEN_ID)).not.toBeNull();
  });

  it('refuses the refresh and deletes the credentials once the agent is deactivated', async () => {
    mockHappyFoxGet('/staff/', [{ id: 14, name: 'George', email: 'george@happyfox-test.com', active: false }]);

    const error = await refusal(revalidateOnRefresh(options(GrantType.REFRESH_TOKEN), env));

    expect(error.code).toBe('invalid_grant');
    expect(error.description).toContain('inactive');
    expect(await store.retrieve(TOKEN_ID)).toBeNull();
  });

  it('refuses the refresh once the agent is deleted', async () => {
    mockHappyFoxGet('/staff/', [{ id: 3, name: 'Someone', email: 'someone@example.com', active: true }]);

    const error = await refusal(revalidateOnRefresh(options(GrantType.REFRESH_TOKEN), env));

    expect(error.description).toContain('no longer exists');
    expect(await store.retrieve(TOKEN_ID)).toBeNull();
  });

  it('refuses the refresh when HappyFox rejects the key, as after the Docs/476 disable toggle', async () => {
    mockHappyFoxGet('/staff/', { error: 'Unauthorized' }, 401);

    const error = await refusal(revalidateOnRefresh(options(GrantType.REFRESH_TOKEN), env));

    expect(error.description).toContain('API key');
    expect(await store.retrieve(TOKEN_ID)).toBeNull();
  });

  it('lets the refresh through when HappyFox cannot answer', async () => {
    mockHappyFoxGet('/staff/', { error: 'Server Error' }, 503);

    await expect(revalidateOnRefresh(options(GrantType.REFRESH_TOKEN), env)).resolves.toBeUndefined();
    expect(await store.retrieve(TOKEN_ID)).not.toBeNull();
  });

  it('refuses the refresh when the stored credentials are gone', async () => {
    await store.delete(TOKEN_ID);

    const error = await refusal(revalidateOnRefresh(options(GrantType.REFRESH_TOKEN), env));

    expect(error.description).toContain('missing or expired');
    expect(sentHappyFoxRequests()).toHaveLength(0);
  });

  it('refuses a grant without a token id', async () => {
    const error = await refusal(revalidateOnRefresh(options(GrantType.REFRESH_TOKEN, {}), env));
    expect(error.code).toBe('invalid_grant');
  });

  it('refuses and deletes a stored record with a crafted region, without calling HappyFox', async () => {
    await store.store(TOKEN_ID, credentials({ region: '../eu/victim/staff#' as any }));

    const error = await refusal(revalidateOnRefresh(options(GrantType.REFRESH_TOKEN), env));

    expect(error.description).toContain('invalid');
    expect(sentHappyFoxRequests()).toHaveLength(0);
    expect(await store.retrieve(TOKEN_ID)).toBeNull();
  });

  it('re-reads the agent on the stored custom domain', async () => {
    await store.store(TOKEN_ID, credentials({ apiHost: 'support.example.com' }));
    fetchMock.get('https://support.example.com')
      .intercept({ path: '/api/1.1/json/staff/', method: 'GET' })
      .reply(200, JSON.stringify([{ id: 14, active: true }]), { headers: { 'Content-Type': 'application/json' } });

    await expect(revalidateOnRefresh(options(GrantType.REFRESH_TOKEN), env)).resolves.toBeUndefined();
    expect(lastHappyFoxRequest().url.origin).toBe('https://support.example.com');
  });
});
