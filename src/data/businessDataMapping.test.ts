import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changedBusinessRecordFields,
  deserializeBusinessRecord,
  parseLegacyWorkspace,
  serializeBusinessRecord
} from './businessDataMapping.js';
import { createEmptyWorkspaceData } from '../domain.js';

test('business data serialization sends exact decimal strings for monetary values', () => {
  const serialized = serializeBusinessRecord('campaigns', {
    id: 'CAM-001',
    targetRevenue: 125000,
    plannedBudget: 123456.75
  });
  assert.equal(serialized.targetRevenue, '125000');
  assert.equal(serialized.plannedBudget, '123456.75');
});

test('empty optional campaign relationships and date values normalize to null', () => {
  const serialized = serializeBusinessRecord('kols', {
    id: 'KOL-001',
    campaignId: '',
    publishDate: '',
    rate: 100000
  });
  assert.equal(serialized.campaignId, null);
  assert.equal(serialized.publishDate, null);
  assert.equal(serialized.rate, '100000');
});

test('business data deserialization converts PostgreSQL numeric and bigint strings safely', () => {
  const campaign = deserializeBusinessRecord('campaigns', {
    id: 'CAM-001',
    targetRevenue: '125000.00',
    plannedBudget: '1000000.00',
    channels: ['Meta Ads']
  });
  assert.equal(campaign.targetRevenue, 125000);
  assert.equal(campaign.plannedBudget, 1000000);

  const content = deserializeBusinessRecord('contents', {
    id: 'CNT-001',
    views: '24800',
    engagement: '8.4'
  });
  assert.equal(content.views, 24800);
  assert.equal(content.engagement, 8.4);
});

test('counter deserialization rejects values that JavaScript cannot represent exactly', () => {
  assert.throws(() => deserializeBusinessRecord('contents', {
    id: 'CNT-001',
    views: '9007199254740993'
  }), /safe integer range/);
});

test('patch generation only includes changed fields and clears optional values with null', () => {
  const patch = changedBusinessRecordFields('tasks', {
    id: 'TSK-001',
    title: 'Review campaign',
    status: 'To Do',
    campaignId: 'CAM-001'
  }, {
    id: 'TSK-001',
    title: 'Review campaign',
    status: 'Done',
    campaignId: undefined
  });

  assert.deepEqual(patch, { status: 'Done', campaignId: null });
});

test('legacy workspace parsing preserves browser-only data while filling absent collections', () => {
  const legacy = parseLegacyWorkspace(JSON.stringify({
    campaigns: [{ id: 'CAM-001', name: 'Legacy campaign' }],
    orders: [{ id: 'ORD-001', amount: 125000 }],
    ads: [],
    notifications: []
  }));

  assert.equal(legacy.campaigns.length, 1);
  assert.equal(legacy.orders.length, 1);
  assert.deepEqual(legacy.tasks, []);
  assert.deepEqual(legacy.competitors, []);
});

test('malformed legacy snapshots are rejected without destructive fallback', () => {
  assert.throws(() => parseLegacyWorkspace('{not-json'), /JSON yang valid/);
  assert.throws(() => parseLegacyWorkspace(JSON.stringify({ tasks: {} })), /tasks.*tidak valid/);
});

test('new workspace data starts with empty managed and browser-only collections', () => {
  const empty = createEmptyWorkspaceData();
  assert.equal(empty.campaigns.length, 0);
  assert.equal(empty.orders.length, 0);
  assert.equal(empty.ads.length, 0);
  assert.equal(empty.notifications.length, 0);
});
