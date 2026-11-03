export type AuthenticatedUser = {
  userId: string;
  email?: string;
  emailVerified?: boolean;
  issuer: string;
};
