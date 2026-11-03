import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizedOrderSchema } from '../src/ingestion/orders.js';

const validOrder = {
  provider: 'scalev',
  externalOrderId: 'SCL-001',
  placedAt: '2026-11-02T10:30:00+07:00',
  status: 'paid',
  grossAmount: '125000.00',
  netAmount: '125000.00',
  payloadHash: 'a'.repeat(64)
};

test('order normalization preserves exact decimal strings and applies defaults', () => {
  const parsed = normalizedOrderSchema.parse(validOrder);
  assert.equal(parsed.grossAmount, '125000.00');
  assert.equal(parsed.netAmount, '125000.00');
  assert.equal(parsed.discountAmount, '0');
  assert.equal(parsed.refundAmount, '0');
  assert.equal(parsed.currency, 'IDR');
});

test('order normalization rejects JavaScript numeric amounts', () => {
  assert.throws(() => normalizedOrderSchema.parse({ ...validOrder, grossAmount: 125000 }));
});

test('order normalization rejects amounts beyond NUMERIC(18,2) precision', () => {
  assert.throws(() => normalizedOrderSchema.parse({
    ...validOrder,
    grossAmount: '12345678901234567.00'
  }));
});

test('order normalization rejects exponential and negative amount notation', () => {
  assert.throws(() => normalizedOrderSchema.parse({ ...validOrder, netAmount: '1.25e5' }));
  assert.throws(() => normalizedOrderSchema.parse({ ...validOrder, netAmount: '-10.00' }));
});
