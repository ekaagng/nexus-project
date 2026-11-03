import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import type { AuthenticatedUser } from '../auth/types.js';
import { createInvitationToken, hashInvitationToken } from '../auth/invitations.js';
import { withUserContext, withWorkspaceContext, getWorkspaceHeader } from '../db.js';
import { AppError } from '../errors.js';

const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254)
});

const acceptInvitationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
});

const invitationParamsSchema = z.object({
  invitationId: z.string().uuid()
});

const memberParamsSchema = z.object({
  memberUserId: z.string().min(1).max(255)
});

function requireUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.authUser) {
    throw new AppError(401, 'authentication_required', 'Authentication is required.');
  }
  return request.authUser;
}

async function expirePendingInvitations(client: PoolClient, workspaceId: string): Promise<void> {
  const expired = await client.query<{ reserved_user_id: string }>(
    `UPDATE workspace_invitations
        SET status = 'expired', updated_at = NOW()
      WHERE workspace_id = $1::uuid
        AND status = 'pending'
        AND expires_at <= NOW()
      RETURNING reserved_user_id`,
    [workspaceId]
  );

  for (const row of expired.rows) {
    await client.query(
      `UPDATE workspace_members
          SET status = 'revoked', updated_at = NOW()
        WHERE workspace_id = $1::uuid
          AND user_id = $2
          AND status = 'invited'`,
      [workspaceId, row.reserved_user_id]
    );
  }
}

async function withOwnerContext<T>(
  pool: Pool,
  user: AuthenticatedUser,
  workspaceId: string,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withWorkspaceContext(pool, user.userId, workspaceId, async (client, role) => {
    if (role !== 'owner') {
      throw new AppError(403, 'owner_access_required', 'Only the workspace Owner can manage access.');
    }
    await expirePendingInvitations(client, workspaceId);
    return operation(client);
  });
}

function mapInvitationDatabaseError(error: unknown): never {
  const databaseError = error as { code?: string; message?: string; constraint?: string };
  if (databaseError.code === '23514' && databaseError.message?.includes('workspace_member_seat_limit_exceeded')) {
    throw new AppError(409, 'workspace_seat_limit_reached', 'This workspace already uses all five seats.');
  }
  if (databaseError.code === '23505' && databaseError.constraint === 'workspace_invitations_one_pending_email_idx') {
    throw new AppError(409, 'invitation_already_pending', 'An active invitation already exists for this email address.');
  }
  throw error;
}

function mapInvitationAcceptanceError(error: unknown): never {
  const databaseError = error as { code?: string; message?: string };
  if (databaseError.code === 'P0001') {
    if (databaseError.message === 'workspace_user_already_a_member') {
      throw new AppError(409, 'workspace_user_already_a_member', 'This account already belongs to the workspace.');
    }
    if (databaseError.message === 'workspace_invitation_reservation_missing') {
      throw new AppError(409, 'workspace_invitation_unavailable', 'The invitation is no longer available.');
    }
    throw new AppError(400, 'workspace_invitation_invalid_or_expired', 'The invitation is invalid, expired, or does not match the verified account email.');
  }
  throw error;
}

export async function registerWorkspaceAccessRoutes(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler
): Promise<void> {
  app.get('/api/v1/workspaces/members', { preHandler: authenticate }, async (request) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    const members = await withOwnerContext(pool, user, workspaceId, async (client) => {
      const result = await client.query(
        `SELECT user_id, role, status, created_at, updated_at
           FROM workspace_members
          WHERE workspace_id = $1::uuid
            AND status = 'active'
            AND user_id NOT LIKE 'invite:%'
          ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC`,
        [workspaceId]
      );
      return result.rows;
    });
    return { members };
  });

  app.get('/api/v1/workspaces/invitations', { preHandler: authenticate }, async (request) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    const invitations = await withOwnerContext(pool, user, workspaceId, async (client) => {
      const result = await client.query(
        `SELECT id, email, role, status, invited_by, expires_at, accepted_at, revoked_at, created_at
           FROM workspace_invitations
          WHERE workspace_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 100`,
        [workspaceId]
      );
      return result.rows;
    });
    return { invitations };
  });

  app.post('/api/v1/workspaces/invitations', { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    const parsed = createInvitationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'invalid_invitation_payload', 'Provide a valid email address for the invitation.');
    }

    const invitationId = randomUUID();
    const reservedUserId = `invite:${invitationId}`;
    const secret = createInvitationToken();

    try {
      const invitation = await withOwnerContext(pool, user, workspaceId, async (client) => {
        const existing = await client.query(
          `SELECT id FROM workspace_invitations
            WHERE workspace_id = $1::uuid
              AND email = $2
              AND status = 'pending'
              AND expires_at > NOW()
            LIMIT 1`,
          [workspaceId, parsed.data.email]
        );
        if (existing.rowCount) {
          throw new AppError(409, 'invitation_already_pending', 'An active invitation already exists for this email address.');
        }

        await client.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role, status)
           VALUES ($1::uuid, $2, 'member', 'invited')`,
          [workspaceId, reservedUserId]
        );

        const inserted = await client.query(
          `INSERT INTO workspace_invitations (
             id, workspace_id, email, role, status, token_hash, reserved_user_id, invited_by
           ) VALUES ($1::uuid, $2::uuid, $3, 'member', 'pending', $4, $5, $6)
           RETURNING id, email, role, status, expires_at, created_at`,
          [invitationId, workspaceId, parsed.data.email, secret.tokenHash, reservedUserId, user.userId]
        );

        await client.query(
          `INSERT INTO audit_logs (workspace_id, actor_user_id, action, entity_type, entity_id, metadata)
           VALUES ($1::uuid, $2, 'workspace.invitation.created', 'workspace_invitation', $3,
                   jsonb_build_object('email', $4, 'role', 'member'))`,
          [workspaceId, user.userId, invitationId, parsed.data.email]
        );
        return inserted.rows[0];
      });

      return reply.code(201).send({
        invitation,
        invitationToken: secret.token,
        delivery: 'manual'
      });
    } catch (error) {
      mapInvitationDatabaseError(error);
    }
  });

  app.post('/api/v1/workspaces/invitations/accept', { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const parsed = acceptInvitationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'invalid_invitation_token', 'The invitation token is invalid.');
    }
    if (!user.email || user.emailVerified !== true) {
      throw new AppError(403, 'verified_email_required', 'Accepting an invitation requires a verified email claim in the identity token.');
    }

    const tokenHash = hashInvitationToken(parsed.data.token);
    try {
      const accepted = await withUserContext(pool, user.userId, async (client) => {
        const result = await client.query<{ workspace_id: string }>(
          'SELECT nexus_private.accept_workspace_invitation($1, $2, $3) AS workspace_id',
          [tokenHash, user.userId, user.email]
        );
        return result.rows[0]?.workspace_id;
      });
      if (!accepted) {
        throw new AppError(500, 'invitation_acceptance_failed', 'The invitation could not be accepted.');
      }
      return reply.code(200).send({ accepted: true, workspaceId: accepted });
    } catch (error) {
      mapInvitationAcceptanceError(error);
    }
  });

  app.delete('/api/v1/workspaces/invitations/:invitationId', { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    const params = invitationParamsSchema.safeParse(request.params);
    if (!params.success) throw new AppError(400, 'invalid_invitation_id', 'A valid invitation ID is required.');

    const revoked = await withOwnerContext(pool, user, workspaceId, async (client) => {
      const result = await client.query<{ reserved_user_id: string; id: string }>(
        `UPDATE workspace_invitations
            SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
          WHERE workspace_id = $1::uuid
            AND id = $2::uuid
            AND status = 'pending'
          RETURNING id, reserved_user_id`,
        [workspaceId, params.data.invitationId]
      );
      const invitation = result.rows[0];
      if (!invitation) throw new AppError(404, 'invitation_not_found', 'A pending invitation with this ID was not found.');

      await client.query(
        `UPDATE workspace_members
            SET status = 'revoked', updated_at = NOW()
          WHERE workspace_id = $1::uuid
            AND user_id = $2
            AND status = 'invited'`,
        [workspaceId, invitation.reserved_user_id]
      );
      await client.query(
        `INSERT INTO audit_logs (workspace_id, actor_user_id, action, entity_type, entity_id)
         VALUES ($1::uuid, $2, 'workspace.invitation.revoked', 'workspace_invitation', $3)`,
        [workspaceId, user.userId, invitation.id]
      );
      return invitation.id;
    });

    return reply.code(200).send({ revoked: true, invitationId: revoked });
  });

  app.delete('/api/v1/workspaces/members/:memberUserId', { preHandler: authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const workspaceId = getWorkspaceHeader(request.headers['x-workspace-id']);
    const params = memberParamsSchema.safeParse(request.params);
    if (!params.success) throw new AppError(400, 'invalid_member_id', 'A valid member ID is required.');
    if (params.data.memberUserId === user.userId) {
      throw new AppError(400, 'cannot_revoke_self', 'The workspace Owner cannot revoke their own access.');
    }

    const revoked = await withOwnerContext(pool, user, workspaceId, async (client) => {
      const result = await client.query(
        `UPDATE workspace_members
            SET status = 'revoked', updated_at = NOW()
          WHERE workspace_id = $1::uuid
            AND user_id = $2
            AND role = 'member'
            AND status = 'active'
          RETURNING user_id`,
        [workspaceId, params.data.memberUserId]
      );
      const member = result.rows[0];
      if (!member) throw new AppError(404, 'member_not_found', 'An active Member with this ID was not found.');

      await client.query(
        `INSERT INTO audit_logs (workspace_id, actor_user_id, action, entity_type, entity_id)
         VALUES ($1::uuid, $2, 'workspace.member.revoked', 'workspace_member', $3)`,
        [workspaceId, user.userId, member.user_id]
      );
      return member.user_id as string;
    });

    return reply.code(200).send({ revoked: true, userId: revoked });
  });
}
