import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { ProviderId } from '../connectors/types.js';

const normalizedOrderSchema = z.object({
  provider: z.enum(['meta_ads', 'scalev', 'lynk_id', 'instagram', 'tiktok', 'youtube', 'manual']),
  externalOrderId: z.string().min(1).max(240),
  placedAt: z.string().datetime({ offset: true }),
  status: z.enum(['pending', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'failed']),
  currency: z.string().regex(/^[A-Z]{3}$/).default('IDR'),
  grossAmount: z.number().finite().nonnegative(),
  discountAmount: z.number().finite().nonnegative().default(0),
  refundAmount: z.number().finite().nonnegative().default(0),
  netAmount: z.number().finite().nonnegative(),
  utmSource: z.string().max(500).optional(),
  utmMedium: z.string().max(500).optional(),
  utmCampaign: z.string().max(500).optional(),
  utmContent: z.string().max(500).optional(),
  utmTerm: z.string().max(500).optional(),
  externalCampaignId: z.string().max(240).optional(),
  internalCampaignId: z.string().max(120).optional(),
  payloadHash: z.string().min(16).max(128),
  sourceUpdatedAt: z.string().datetime({ offset: true }).optional()
});

export type NormalizedOrder = z.infer<typeof normalizedOrderSchema>;

export async function upsertNormalizedOrders(
  client: PoolClient,
  workspaceId: string,
  connectionId: string,
  records: NormalizedOrder[]
): Promise<{ processed: number }> {
  let processed = 0;
  for (const input of records) {
    const record = normalizedOrderSchema.parse(input);
    await client.query(
      `INSERT INTO orders (
        workspace_id, connection_id, provider, external_order_id, placed_at, status,
        currency, gross_amount, discount_amount, refund_amount, net_amount,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        external_campaign_id, internal_campaign_id, payload_hash, source_updated_at, synced_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20::timestamptz, NOW()
      )
      ON CONFLICT (workspace_id, provider, external_order_id) DO UPDATE SET
        connection_id = EXCLUDED.connection_id,
        placed_at = EXCLUDED.placed_at,
        status = EXCLUDED.status,
        currency = EXCLUDED.currency,
        gross_amount = EXCLUDED.gross_amount,
        discount_amount = EXCLUDED.discount_amount,
        refund_amount = EXCLUDED.refund_amount,
        net_amount = EXCLUDED.net_amount,
        utm_source = EXCLUDED.utm_source,
        utm_medium = EXCLUDED.utm_medium,
        utm_campaign = EXCLUDED.utm_campaign,
        utm_content = EXCLUDED.utm_content,
        utm_term = EXCLUDED.utm_term,
        external_campaign_id = EXCLUDED.external_campaign_id,
        internal_campaign_id = EXCLUDED.internal_campaign_id,
        payload_hash = EXCLUDED.payload_hash,
        source_updated_at = EXCLUDED.source_updated_at,
        synced_at = NOW(),
        updated_at = NOW()
      WHERE orders.source_updated_at IS NULL
        OR EXCLUDED.source_updated_at IS NULL
        OR EXCLUDED.source_updated_at >= orders.source_updated_at`,
      [
        workspaceId, connectionId, record.provider, record.externalOrderId, record.placedAt, record.status,
        record.currency, record.grossAmount, record.discountAmount, record.refundAmount, record.netAmount,
        record.utmSource ?? null, record.utmMedium ?? null, record.utmCampaign ?? null,
        record.utmContent ?? null, record.utmTerm ?? null, record.externalCampaignId ?? null,
        record.internalCampaignId ?? null, record.payloadHash, record.sourceUpdatedAt ?? null
      ]
    );
    processed += 1;
  }
  return { processed };
}
