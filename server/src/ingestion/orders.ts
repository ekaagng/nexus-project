import { z } from 'zod';
import type { PoolClient } from 'pg';

const decimalAmountSchema = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/);

export const normalizedOrderSchema = z.object({
  provider: z.enum(['scalev', 'lynk_id', 'manual']),
  externalOrderId: z.string().min(1).max(240),
  placedAt: z.string().datetime({ offset: true }),
  status: z.enum(['pending', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'failed']),
  currency: z.string().regex(/^[A-Z]{3}$/).default('IDR'),
  grossAmount: decimalAmountSchema,
  discountAmount: decimalAmountSchema.default('0'),
  refundAmount: decimalAmountSchema.default('0'),
  netAmount: decimalAmountSchema,
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

export type NormalizedOrder = z.input<typeof normalizedOrderSchema>;

const lineageUpdate = `
  DO UPDATE SET entity_id = EXCLUDED.entity_id,
                payload_hash = EXCLUDED.payload_hash,
                import_job_id = EXCLUDED.import_job_id,
                validation_state = EXCLUDED.validation_state,
                imported_at = NOW(),
                synced_at = NOW()
`;

export async function upsertNormalizedOrders(
  client: PoolClient,
  workspaceId: string,
  connectionId: string | null,
  records: NormalizedOrder[],
  syncJobId?: string
): Promise<{ processed: number }> {
  if (records.length === 0) return { processed: 0 };

  const normalizedRecords = records.map((record) => normalizedOrderSchema.parse(record));
  const firstRecord = normalizedRecords[0];
  if (!firstRecord) return { processed: 0 };
  const providers = new Set(normalizedRecords.map((record) => record.provider));
  if (providers.size !== 1) throw new Error('A single ingestion batch must contain one provider.');
  const provider = firstRecord.provider;

  if (provider === 'manual' && connectionId !== null) {
    throw new Error('Manual imports must not be attached to a provider connection.');
  }
  if (provider !== 'manual' && !connectionId) {
    throw new Error('A provider connection is required for external order ingestion.');
  }

  if (connectionId) {
    const connection = await client.query<{ provider: string }>(
      `SELECT provider FROM integration_connections
       WHERE id = $1::uuid AND workspace_id = $2::uuid`,
      [connectionId, workspaceId]
    );
    if (connection.rows[0]?.provider !== provider) {
      throw new Error('The order provider does not match the selected workspace connection.');
    }
  }

  let processed = 0;
  for (const record of normalizedRecords) {

    const saved = await client.query<{ id: string }>(
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
        OR (EXCLUDED.source_updated_at IS NOT NULL AND EXCLUDED.source_updated_at >= orders.source_updated_at)
      RETURNING id`,
      [
        workspaceId, connectionId, record.provider, record.externalOrderId, record.placedAt, record.status,
        record.currency, record.grossAmount, record.discountAmount, record.refundAmount, record.netAmount,
        record.utmSource ?? null, record.utmMedium ?? null, record.utmCampaign ?? null,
        record.utmContent ?? null, record.utmTerm ?? null, record.externalCampaignId ?? null,
        record.internalCampaignId ?? null, record.payloadHash, record.sourceUpdatedAt ?? null
      ]
    );

    const orderId = saved.rows[0]?.id;
    if (orderId) {
      const conflictTarget = connectionId
        ? `ON CONFLICT (workspace_id, provider, connection_id, source_record_id)
           WHERE connection_id IS NOT NULL${lineageUpdate}`
        : `ON CONFLICT (workspace_id, provider, source_record_id)
           WHERE connection_id IS NULL${lineageUpdate}`;
      await client.query(
        `INSERT INTO source_lineage (
          workspace_id, connection_id, provider, entity_type, entity_id,
          source_record_id, payload_hash, import_job_id, validation_state
        ) VALUES ($1::uuid, $2::uuid, $3, 'order', $4::uuid, $5, $6, $7::uuid, 'valid')
        ${conflictTarget}`,
        [workspaceId, connectionId, record.provider, orderId, record.externalOrderId, record.payloadHash, syncJobId ?? null]
      );
    }
    processed += 1;
  }
  return { processed };
}
