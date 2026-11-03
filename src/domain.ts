export type PageId =
  | 'overview' | 'briefs' | 'campaigns' | 'budget' | 'tasks' | 'calendar'
  | 'content' | 'ads-sales' | 'kol' | 'analytics' | 'competitors'
  | 'ai-lab' | 'reports' | 'integrations' | 'settings' | 'access' | 'campaign-detail';

export type Campaign = {
  id: string; name: string; objective: string; owner: string; startDate: string; endDate: string;
  targetRevenue: number; plannedBudget: number; status: string; channels: string[]; description?: string;
};
export type Task = {
  id: string; title: string; description?: string; assignee: string; priority: string; status: string;
  dueDate: string; owner?: string; campaignId?: string; kind?: string;
};
export type ContentItem = {
  id: string; title: string; platform: string; pillar: string; format: string; hook: string; cta: string;
  owner: string; status: string; publishDate: string; campaignId?: string; views?: number; engagement?: number;
};
export type Expense = {
  id: string; title: string; category: string; vendor: string; amount: number; date: string;
  campaignId?: string; channel: string; type: 'actual' | 'committed';
};
export type Kol = {
  id: string; name: string; platform: string; handle: string; instagramUrl: string; niche: string;
  contact: string; rate: number; stage: string; campaignId?: string; publishDate?: string; notes?: string;
};
export type Order = {
  id: string; source: string; date: string; status: string; amount: number; utm?: string; campaignId?: string;
};
export type AdMetric = {
  id: string; date: string; campaignId?: string; campaignName: string; platform: string; spend: number;
  impressions: number; reach?: number; clicks: number; lpv?: number; atc?: number; checkout?: number;
  purchases: number; attributedRevenue?: number; source: string;
};
export type Brief = { id: string; title: string; type: string; campaignId?: string; status: string; owner: string; updatedAt: string };
export type Experiment = { id: string; name: string; hypothesis: string; changeMade: string; primaryMetric: string; successCriteria: string; owner: string; status: string; startDate: string; endDate?: string; outcome?: string; campaignId?: string };
export type Competitor = { id: string; name: string; platform: string; handle: string; url: string; label: string; notes: string; status: string };
export type CompetitorPost = { id: string; competitorId: string; title: string; url: string; observedAt: string; views?: number; likes?: number; comments?: number; shares?: number; format: string; hook: string; angle: string; note: string };
export type WorkspaceData = {
  campaigns: Campaign[]; tasks: Task[]; contents: ContentItem[]; expenses: Expense[]; kols: Kol[];
  orders: Order[]; ads: AdMetric[]; briefs: Brief[]; experiments: Experiment[]; competitors: Competitor[]; competitorPosts: CompetitorPost[];
  notifications: { id: string; title: string; detail: string; time: string; level: 'info'|'warning'|'success' }[];
  updatedAt: string;
};

/** Calendar date key fixed to the PRD workspace timezone (Asia/Jakarta). */
export function jakartaDateKey(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Add whole Jakarta calendar days without relying on the device timezone. */
export function addJakartaDays(offset: number, from: string = jakartaDateKey()): string {
  const [year, month, day] = from.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

const date = (offset: number) => addJakartaDays(offset);

export const demoData: WorkspaceData = {
  updatedAt: new Date().toISOString(),
  campaigns: [
    { id: 'CAM-2026-0001', name: 'Always-on THP Tracker', objective: 'Sales', owner: 'Marketing Lead', startDate: date(-12), endDate: date(18), targetRevenue: 49500000, plannedBudget: 12000000, status: 'Active', channels: ['Meta Ads', 'Instagram'] },
    { id: 'CAM-2026-0002', name: '21 Days Reset', objective: 'Awareness', owner: 'Content Lead', startDate: date(-4), endDate: date(24), targetRevenue: 18000000, plannedBudget: 4500000, status: 'Active', channels: ['Instagram', 'TikTok'] },
    { id: 'CAM-2026-0003', name: 'Creator Partnership Q4', objective: 'Sales', owner: 'KOL Manager', startDate: date(2), endDate: date(32), targetRevenue: 22000000, plannedBudget: 8000000, status: 'Planned', channels: ['KOL', 'Instagram'] },
    { id: 'CAM-2026-0004', name: 'October Retrospective', objective: 'Retention', owner: 'Marketing Lead', startDate: date(-30), endDate: date(-2), targetRevenue: 15000000, plannedBudget: 3500000, status: 'Completed', channels: ['Email', 'Instagram'] }
  ],
  tasks: [
    { id: 'TSK-2026-00001', title: 'Review creative angle: daily progress', assignee: 'Content Lead', priority: 'High', status: 'Review', dueDate: date(0), campaignId: 'CAM-2026-0001' },
    { id: 'TSK-2026-00002', title: 'Reconcile checkout with order export', assignee: 'Data Operator', priority: 'Urgent', status: 'In Progress', dueDate: date(-1), campaignId: 'CAM-2026-0001' },
    { id: 'TSK-2026-00003', title: 'Approve creator brief', assignee: 'Marketing Lead', priority: 'Medium', status: 'To Do', dueDate: date(1), campaignId: 'CAM-2026-0003' },
    { id: 'TSK-2026-00004', title: 'Prepare weekly content batch', assignee: 'Content Lead', priority: 'Medium', status: 'Backlog', dueDate: date(3), campaignId: 'CAM-2026-0002' },
    { id: 'TSK-2026-00005', title: 'Update Meta Ads experiment log', assignee: 'Ads Specialist', priority: 'Low', status: 'Done', dueDate: date(-2), campaignId: 'CAM-2026-0001' }
  ],
  contents: [
    { id: 'CNT-2026-0001', title: '21 Days Give Me a New Life', platform: 'Instagram', pillar: 'Self mastery', format: 'Carousel', hook: 'Give me 21 days...', cta: 'Klik link di bio', owner: 'Content Lead', status: 'Published', publishDate: date(-1), campaignId: 'CAM-2026-0002', views: 24800, engagement: 8.4 },
    { id: 'CNT-2026-0002', title: 'Habit tracker walkthrough', platform: 'TikTok', pillar: 'Product education', format: 'Short video', hook: 'POV: kamu mulai konsisten', cta: 'Cek link di bio', owner: 'Video Editor', status: 'Scheduled', publishDate: date(1), campaignId: 'CAM-2026-0001', views: 0, engagement: 0 },
    { id: 'CNT-2026-0003', title: 'Discipline beats motivation', platform: 'Instagram', pillar: 'Self development', format: 'Carousel', hook: 'Motivasi tidak selalu datang', cta: 'Simpan untuk nanti', owner: 'Content Lead', status: 'Review', publishDate: date(2), campaignId: 'CAM-2026-0002', views: 0, engagement: 0 },
    { id: 'CNT-2026-0004', title: 'One dashboard, four life areas', platform: 'YouTube', pillar: 'Product education', format: 'Shorts', hook: 'Satu sistem untuk hidupmu', cta: 'Pelajari lebih lanjut', owner: 'Video Editor', status: 'Production', publishDate: date(4), campaignId: 'CAM-2026-0001', views: 0, engagement: 0 }
  ],
  expenses: [
    { id: 'EXP-2026-00001', title: 'Landing page copywriting', category: 'Production', vendor: 'Creative Partner', amount: 650000, date: date(-2), campaignId: 'CAM-2026-0001', channel: 'Content', type: 'actual' },
    { id: 'EXP-2026-00002', title: 'Creator fee — batch 1', category: 'KOL', vendor: 'Creator Partner', amount: 1800000, date: date(-1), campaignId: 'CAM-2026-0003', channel: 'KOL', type: 'committed' },
    { id: 'EXP-2026-00003', title: 'Video editing', category: 'Production', vendor: 'Creative Studio', amount: 750000, date: date(-3), campaignId: 'CAM-2026-0002', channel: 'Content', type: 'actual' }
  ],
  kols: [
    { id: 'KOL-00001', name: 'Alya Putri', platform: 'Instagram', handle: '@alyaputri', instagramUrl: 'https://instagram.com/', niche: 'Productivity', contact: 'creator@example.com', rate: 1500000, stage: 'Negotiation', campaignId: 'CAM-2026-0003', notes: 'Audience pekerja muda' },
    { id: 'KOL-00002', name: 'Raka Pratama', platform: 'TikTok', handle: '@rakapratama', instagramUrl: '', niche: 'Self development', contact: 'creator2@example.com', rate: 2200000, stage: 'Briefed', campaignId: 'CAM-2026-0003', notes: 'Short-form education' },
    { id: 'KOL-00003', name: 'Nadia S.', platform: 'Instagram', handle: '@nadiaworks', instagramUrl: 'https://instagram.com/', niche: 'Lifestyle', contact: 'creator3@example.com', rate: 900000, stage: 'Prospect', notes: 'Belum dihubungi' }
  ],
  orders: [
    { id: 'ORD-DEMO-1001', source: 'Scalev', date: date(-1), status: 'Paid', amount: 99000, utm: 'ig_bio', campaignId: 'CAM-2026-0001' },
    { id: 'ORD-DEMO-1002', source: 'Lynk.id', date: date(-1), status: 'Paid', amount: 149000, utm: 'creator_alyaputri', campaignId: 'CAM-2026-0003' },
    { id: 'ORD-DEMO-1003', source: 'Manual', date: date(-2), status: 'Refunded', amount: 99000, utm: 'meta_ads', campaignId: 'CAM-2026-0001' },
    { id: 'ORD-DEMO-1004', source: 'Scalev', date: date(-3), status: 'Paid', amount: 99000, utm: 'ig_reels', campaignId: 'CAM-2026-0002' }
  ],
  ads: [
    { id: 'ADS-DEMO-001', date: date(-1), campaignId: 'CAM-2026-0001', campaignName: 'Always-on THP Tracker', platform: 'Meta Ads', spend: 945000, impressions: 48200, reach: 39100, clicks: 405, lpv: 318, atc: 55, checkout: 16, purchases: 12, attributedRevenue: 1188000, source: 'Demo seed' },
    { id: 'ADS-DEMO-002', date: date(-2), campaignId: 'CAM-2026-0001', campaignName: 'Always-on THP Tracker', platform: 'Meta Ads', spend: 910000, impressions: 46700, reach: 37800, clicks: 392, lpv: 307, atc: 48, checkout: 14, purchases: 10, attributedRevenue: 990000, source: 'Demo seed' },
    { id: 'ADS-DEMO-003', date: date(-3), campaignId: 'CAM-2026-0001', campaignName: 'Always-on THP Tracker', platform: 'Meta Ads', spend: 875000, impressions: 45100, reach: 36500, clicks: 386, lpv: 296, atc: 51, checkout: 15, purchases: 11, attributedRevenue: 1089000, source: 'Demo seed' }
  ],
  briefs: [
    { id: 'BRF-0001', title: 'Campaign master brief', type: 'Campaign', campaignId: 'CAM-2026-0001', status: 'Approved', owner: 'Marketing Lead', updatedAt: date(-5) },
    { id: 'BRF-0002', title: '21-day reset carousel', type: 'Content', campaignId: 'CAM-2026-0002', status: 'In review', owner: 'Content Lead', updatedAt: date(-1) },
    { id: 'BRF-0003', title: 'Creator partnership deliverables', type: 'KOL', campaignId: 'CAM-2026-0003', status: 'Draft', owner: 'KOL Manager', updatedAt: date(-2) }
  ],
  experiments: [
    { id: 'EXP-TEST-001', name: 'Creative hook test — progress vs motivation', hypothesis: 'Hook yang menunjukkan progres konkret dapat meningkatkan LPV rate dibanding hook motivasi umum.', changeMade: 'Menguji dua opening video dengan audience dan budget sebanding.', primaryMetric: 'Landing page view rate', successCriteria: 'Minimal +15% LPV rate tanpa kenaikan CPC lebih dari 10%.', owner: 'Ads Specialist', status: 'Running', startDate: date(-2), campaignId: 'CAM-2026-0001' }
  ],
  competitors: [
    { id: 'CMP-0001', name: 'Productivity Notes', platform: 'Instagram', handle: '@productivitynotes', url: 'https://instagram.com/', label: 'Productivity', notes: 'Publik; pantau format carousel', status: 'Tracking' },
    { id: 'CMP-0002', name: 'Habit Journey', platform: 'TikTok', handle: '@habitjourney', url: 'https://tiktok.com/', label: 'Habit building', notes: 'Fokus short-form hook', status: 'Tracking' }
  ],
  competitorPosts: [
    { id: 'CMP-POST-001', competitorId: 'CMP-0001', title: 'The 1% daily rule', url: 'https://instagram.com/', observedAt: date(-1), views: 18200, likes: 1200, comments: 84, shares: 340, format: 'Carousel', hook: 'Kamu tidak butuh perubahan besar', angle: 'Incremental improvement', note: 'Public metrics sample; not private reach/saves/conversion.' }
  ],
  notifications: [
    { id: 'NTF-001', title: 'Task melewati deadline', detail: 'Reconcile checkout with order export', time: '08:12', level: 'warning' },
    { id: 'NTF-002', title: 'Brief menunggu approval', detail: '21-day reset carousel', time: 'Kemarin', level: 'info' },
    { id: 'NTF-003', title: 'Snapshot data tersedia', detail: 'Meta Ads · data demo', time: '07:45', level: 'success' }
  ]
};

export const STORAGE_KEY = 'nexus.workspace.v03';
export function loadWorkspace(): WorkspaceData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return demoData;
    const parsed = JSON.parse(raw) as WorkspaceData;
    if (!parsed || !Array.isArray(parsed.campaigns) || !Array.isArray(parsed.tasks)) return demoData;
    return parsed;
  } catch {
    return demoData;
  }
}

export function makeId(prefix: string, count: number, existingIds: string[] = [], year = new Date().getFullYear()) {
  const maxExisting = existingIds.reduce((max, id) => {
    const parts = id.split('-');
    const idYear = Number(parts[1]);
    const serial = Number(parts[2]);
    return idYear === year && Number.isFinite(serial) ? Math.max(max, serial) : max;
  }, 0);
  const serial = String(Math.max(count, maxExisting) + 1).padStart(prefix === 'CAM' ? 4 : 5, '0');
  return `${prefix}-${year}-${serial}`;
}

export function rupiah(value?: number) {
  if (value === undefined || value === null || Number.isNaN(value)) return 'N/A';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
}
export function compactNumber(value?: number) {
  if (value === undefined || value === null || Number.isNaN(value)) return 'N/A';
  return new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
export function shortDate(value?: string) {
  if (!value) return 'N/A';
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short' }).format(d);
}


/** Generate stable human-readable IDs that do not collide after records are removed. */
export function makeSequentialId(prefix: string, existingIds: string[], pad = 5): string {
  const maxExisting = existingIds.reduce((max, id) => {
    const match = id.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-([0-9]+)$`));
    const serial = match ? Number(match[1]) : 0;
    return Number.isFinite(serial) ? Math.max(max, serial) : max;
  }, 0);
  return `${prefix}-${String(maxExisting + 1).padStart(pad, '0')}`;
}
