export type AuthenticatedUser = {
  userId: string;
  email?: string;
  emailVerified?: boolean;
  issuer: string;
  authMethod?: 'bearer' | 'session';
  sessionId?: string;
  sessionExpiresAt?: string;
};
