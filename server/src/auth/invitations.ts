import { createHash, randomBytes } from 'node:crypto';

export type InvitationToken = {
  token: string;
  tokenHash: string;
};

export function createInvitationToken(): InvitationToken {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashInvitationToken(token)
  };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
