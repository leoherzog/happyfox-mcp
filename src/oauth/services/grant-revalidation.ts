/**
 * Refresh-time re-check of a grant's HappyFox credentials and consenting agent. Runs as the
 * OAuth provider's tokenExchangeCallback, so a disabled API key or a deactivated agent loses
 * access within one access-token lifetime without adding a HappyFox call to MCP requests.
 */

import { GrantType, OAuthError } from '@cloudflare/workers-oauth-provider';
import type { TokenExchangeCallbackOptions } from '@cloudflare/workers-oauth-provider';
import { Env, HappyFoxAuth } from '../../types';
import { OAuthProps } from '../types';
import { CredentialStore, storedAuth } from './credential-store';
import { checkStaffStatus, StaffStatus } from './happyfox-validator';

const REFUSALS: Record<Exclude<StaffStatus, 'active' | 'unknown'>, string> = {
  inactive: 'The HappyFox agent who authorized this connection is inactive.',
  missing: 'The HappyFox agent who authorized this connection no longer exists.',
  rejected: 'HappyFox no longer accepts the stored API key and auth code.',
};

function refuse(description: string): OAuthError {
  return new OAuthError('invalid_grant', { description: `${description} Please reconnect.` });
}

/**
 * Refuse a refresh when the stored credentials are gone or invalid, HappyFox rejects them, or
 * the consenting agent is inactive or deleted. The stored credentials are then deleted, so access
 * tokens already issued fail too. When HappyFox cannot be reached, the refresh proceeds.
 * @throws OAuthError `invalid_grant`, which sends the client back through consent
 */
export async function revalidateOnRefresh(options: TokenExchangeCallbackOptions, env: Env): Promise<void> {
  if (options.grantType !== GrantType.REFRESH_TOKEN) return;

  const { tokenId } = (options.props ?? {}) as Partial<OAuthProps>;
  if (typeof tokenId !== 'string') {
    throw refuse('The grant carries no HappyFox credentials.');
  }

  const store = new CredentialStore(env.OAUTH_KV, env.CREDENTIAL_ENCRYPTION_KEY);
  const stored = await store.retrieve(tokenId);
  if (!stored) {
    throw refuse('The stored HappyFox credentials are missing or expired.');
  }

  let auth: HappyFoxAuth;
  try {
    auth = storedAuth(stored);
  } catch {
    await store.delete(tokenId);
    throw refuse('The stored HappyFox credentials are invalid.');
  }

  const status = await checkStaffStatus(auth, stored.staffId);
  if (status === 'active' || status === 'unknown') return;

  await store.delete(tokenId);
  throw refuse(REFUSALS[status]);
}
