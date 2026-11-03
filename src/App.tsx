import React, { useEffect, useRef, useState } from 'react';
import { AuthProvider, WorkspaceProvider, useAuth, useWorkspace } from './auth/AuthProvider';
import { AccessManagement } from './auth/AccessManagement';
import { SessionControls } from './auth/SessionControls';
import type { AuthUser, WorkspaceSummary } from './auth/api';
import {
  AdMetric, Brief, Campaign, Competitor, ContentItem, Expense, Experiment, Kol, Order,
  PageId, Task, WorkspaceData, addJakartaDays, compactNumber, createEmptyWorkspaceData, demoData, jakartaDateKey, makeId, makeSequentialId, rupiah, shortDate, STORAGE_KEY
} from './domain';
import {
  loadBusinessCollections, migrateLegacyBusinessCollections,
  persistBusinessCollectionChanges, replaceBusinessCollections
} from './data/businessDataApi';
import {
  localOnlyWorkspaceData, parseLegacyWorkspace, type BusinessDataKey, BUSINESS_DATA_RESOURCES
} from './data/businessDataMapping';

type ModalKind = 'campaign'|'task'|'content'|'expense'|'kol'|'order'|'brief'|'competitor'|'action'|'experiment'|null;
type FieldOption = { label: string; value: string };
type FieldDef = { key: string; label: string; type?: string; required?: boolean; options?: FieldOption[]; step?: number; placeholder?: string; wide?: boolean };
const offsetDate = (offset: number) => addJakartaDays(offset);

const navGroups: { title: string; phase?: string; items: { id: PageId; label: string; icon: string }[] }[] = [
  { title: 'COMMAND', items: [{ id: 'overview', label: 'Overview', icon: 'grid' }] },
  { title: 'PHASE 01 · PLAN', phase: '01', items: [
    { id: 'briefs', label: 'Brief Library', icon: 'file' },
    { id: 'campaigns', label: 'Campaigns', icon: 'layers' },
    { id: 'budget', label: 'Budget Control', icon: 'wallet' }
  ] },
  { title: 'PHASE 02 · EXECUTE', phase: '02', items: [
    { id: 'tasks', label: 'Tasks & Approvals', icon: 'check-square' },
    { id: 'calendar', label: 'Content Calendar', icon: 'calendar' },
    { id: 'content', label: 'Content Studio', icon: 'image' },
    { id: 'ads-sales', label: 'Ads & Sales', icon: 'chart' },
    { id: 'kol', label: 'KOL & Creators', icon: 'users' }
  ] },
  { title: 'PHASE 03 · OPTIMIZE', phase: '03', items: [
    { id: 'analytics', label: 'Performance Analytics', icon: 'activity' },
    { id: 'competitors', label: 'Competitor Intelligence', icon: 'radar' },
    { id: 'ai-lab', label: 'AI Insight Lab', icon: 'sparkles' },
    { id: 'reports', label: 'Reports & Exports', icon: 'file-chart' }
  ] },
  { title: 'WORKSPACE', items: [
    { id: 'integrations', label: 'Integrations', icon: 'plug' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
    { id: 'access', label: 'Access Management', icon: 'shield' }
  ] }
];

const pageTitles: Record<PageId, { title: string; subtitle: string; phase: string }> = {
  overview: { title: 'Command Overview', subtitle: 'Satu pandangan untuk keputusan marketing hari ini.', phase: 'COMMAND CENTER' },
  briefs: { title: 'Brief Library', subtitle: 'Satu sumber konteks untuk campaign, content, Ads, dan KOL.', phase: 'PHASE 01 / PLAN' },
  campaigns: { title: 'Campaigns', subtitle: 'Rencanakan, hubungkan, dan evaluasi setiap campaign.', phase: 'PHASE 01 / PLAN' },
  budget: { title: 'Budget Control', subtitle: 'Pantau planned, committed, actual, dan remaining.', phase: 'PHASE 01 / PLAN' },
  tasks: { title: 'Tasks & Approvals', subtitle: 'Pastikan pekerjaan bergerak dengan PIC dan deadline yang jelas.', phase: 'PHASE 02 / EXECUTE' },
  calendar: { title: 'Content Calendar', subtitle: 'Satukan publish date, deadline, dan timeline campaign.', phase: 'PHASE 02 / EXECUTE' },
  content: { title: 'Content Studio', subtitle: 'Kelola ide, brief, produksi, approval, dan performa konten.', phase: 'PHASE 02 / EXECUTE' },
  'ads-sales': { title: 'Ads & Sales', subtitle: 'Pisahkan performa iklan, transaksi aktual, dan atribusi.', phase: 'PHASE 02 / EXECUTE' },
  kol: { title: 'KOL & Creators', subtitle: 'Kelola pipeline kreator, deliverables, biaya, dan hasil.', phase: 'PHASE 02 / EXECUTE' },
  analytics: { title: 'Performance Analytics', subtitle: 'Baca kinerja lintas channel dengan definisi dan sumber yang jelas.', phase: 'PHASE 03 / OPTIMIZE' },
  competitors: { title: 'Competitor Intelligence', subtitle: 'Pelajari pola konten publik tanpa mengasumsikan insight privat.', phase: 'PHASE 03 / OPTIMIZE' },
  'ai-lab': { title: 'AI Insight Lab', subtitle: 'Evidence, interpretasi, hipotesis, dan eksperimen berikutnya.', phase: 'PHASE 03 / OPTIMIZE' },
  reports: { title: 'Reports & Exports', subtitle: 'Ringkasan campaign, channel, budget, dan pembelajaran.', phase: 'PHASE 03 / OPTIMIZE' },
  integrations: { title: 'Integrations', subtitle: 'Kelola sumber data dan pantau freshness setiap konektor.', phase: 'WORKSPACE' },
  settings: { title: 'Settings', subtitle: 'Preferensi workspace, definisi data, dan backup lokal.', phase: 'WORKSPACE' },
  access: { title: 'Access Management', subtitle: 'Allowlist workspace tertutup — Owner only.', phase: 'WORKSPACE / OWNER' },
  'campaign-detail': { title: 'Campaign Workspace', subtitle: 'Konteks, eksekusi, biaya, dan hasil dalam satu ruang kerja.', phase: 'CAMPAIGN' }
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  const shapes: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    file: <><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 14h2"/><path d="M7 5V3h10v2"/></>,
    'check-square': <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h2M14 14h2M8 17h2"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>,
    chart: <><path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/><path d="M17 6h3v3"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
    radar: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 20 5M12 3v9h9"/></>,
    sparkles: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
    'file-chart': <><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M9 17v-3M13 17v-5M17 17v-2"/></>,
    plug: <><path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.4.8l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.4-.8l-1.7.7-1.4-2.4L6.6 15a8 8 0 0 1 0-1.7l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.4-.8L10 8h2.8l.3 1.8a8 8 0 0 1 1.4.8l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1 0 1.6Z" transform="translate(1 0) scale(.9)"/></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></>,
    chevron: <><path d="m8 10 4 4 4-4"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 12-2L20 12M4 12l2.5 5a7 7 0 0 0 12-2"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    filter: <><path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z"/></>,
    arrowUp: <><path d="m6 14 6-6 6 6"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>
  };
  return <svg {...common}>{shapes[name] || <circle cx="12" cy="12" r="8" />}</svg>;
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function Panel({ title, action, children, className = '' }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>
    {title && <div className="panel-head"><h3>{title}</h3>{action}</div>}
    {children}
  </section>;
}
function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name="sparkles" size={20}/></span><strong>{title}</strong><p>{body}</p>{action}</div>;
}
function MetricCard({ label, value, delta, detail, icon, tone = 'violet' }: { label: string; value: string; delta?: string; detail: string; icon: string; tone?: string }) {
  return <div className="metric-card">
    <div className="metric-top"><span>{label}</span><span className={`metric-icon icon-${tone}`}><Icon name={icon} size={16}/></span></div>
    <div className="metric-value">{value}</div>
    <div className="metric-bottom">{delta && <span className={delta.startsWith('+') ? 'positive' : delta.startsWith('-') ? 'negative' : 'muted'}>{delta}</span>}<small>{detail}</small></div>
  </div>;
}
function SectionTitle({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: React.ReactNode }) {
  return <div className="section-title"><div>{eyebrow && <span>{eyebrow}</span>}<h2>{title}</h2></div>{action}</div>;
}
function Progress({ value, tone = 'violet' }: { value: number; tone?: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return <div className={`progress progress-${tone}`}><span style={{ width: `${bounded}%` }}/></div>;
}
function TrendChart({ compact = false }: { compact?: boolean }) {
  const values = [22, 29, 25, 38, 34, 46, 41, 53, 49, 63, 57, 72];
  const points = values.map((v, i) => `${12 + i * 30},${108 - v * 1.18}`).join(' ');
  const spend = values.map((v, i) => `${12 + i * 30},${118 - v * .82}`).join(' ');
  return <div className={`chart-wrap ${compact ? 'chart-compact' : ''}`}>
    <svg viewBox="0 0 360 130" role="img" aria-label="Grafik tren revenue dan spend demo">
      <defs><linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9985ff" stopOpacity=".26"/><stop offset="1" stopColor="#9985ff" stopOpacity="0"/></linearGradient></defs>
      {[25,55,85,115].map(y => <line key={y} x1="5" x2="355" y1={y} y2={y} stroke="rgba(169,164,198,.13)" strokeDasharray="3 5"/>)}
      <polygon points={`12,118 ${points} 342,118`} fill="url(#revenueFill)"/>
      <polyline points={spend} fill="none" stroke="#70cfff" strokeWidth="2" strokeDasharray="4 5" opacity=".8" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={points} fill="none" stroke="#9985ff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
      {values.map((v,i) => <circle key={i} cx={12+i*30} cy={108-v*1.18} r="2.5" fill="#c7bbff"/>)}
    </svg>
    <div className="chart-axis"><span>01 Nov</span><span>03 Nov</span><span>05 Nov</span><span>07 Nov</span><span>09 Nov</span><span>Today</span></div>
  </div>;
}
function StatusDot({ status }: { status: 'connected'|'stale'|'planned'|'error'|'unavailable' }) {
  return <span className={`status-dot status-${status}`}><i/>{status === 'connected' ? 'Connected' : status === 'stale' ? 'Stale' : status === 'error' ? 'Error' : status === 'planned' ? 'Planned' : 'Unavailable'}</span>;
}

const formConfig: Record<Exclude<ModalKind, null>, { title: string; prefix: string; fields: FieldDef[] }> = {
  campaign: { title: 'Create campaign', prefix: 'CAM', fields: [
    { key: 'name', label: 'Campaign name', required: true, step: 0 },
    { key: 'objective', label: 'Objective', type: 'select', options: ['Sales','Awareness','Traffic','Leads','Retention'].map(x=>({label:x,value:x})), step: 0 },
    { key: 'owner', label: 'Campaign owner', required: true, step: 0 },
    { key: 'startDate', label: 'Start date', type: 'date', required: true, step: 0 },
    { key: 'endDate', label: 'End date', type: 'date', required: true, step: 0 },
    { key: 'targetRevenue', label: 'Target revenue (IDR)', type: 'number', required: true, step: 1 },
    { key: 'plannedBudget', label: 'Planned budget (IDR)', type: 'number', required: true, step: 1 },
    { key: 'channels', label: 'Channels', placeholder: 'Meta Ads, Instagram, TikTok', step: 1 },
    { key: 'status', label: 'Status', type: 'select', options: ['Draft','Planned','Active','Paused','Completed'].map(x=>({label:x,value:x})), step: 1 }
  ] },
  task: { title: 'Create task', prefix: 'TSK', fields: [
    { key: 'title', label: 'Task title', required: true }, { key: 'description', label: 'Description', type: 'textarea', wide: true },
    { key: 'owner', label: 'Task owner', required: true }, { key: 'assignee', label: 'Assignee / PIC', required: true }, { key: 'priority', label: 'Priority', type: 'select', options: ['Low','Medium','High','Urgent'].map(x=>({label:x,value:x})) },
    { key: 'status', label: 'Status', type: 'select', options: ['Backlog','To Do','In Progress','Review','Blocked','Done'].map(x=>({label:x,value:x})) },
    { key: 'dueDate', label: 'Due date', type: 'date', required: true }, { key: 'campaignId', label: 'Campaign', type: 'campaign' }
  ] },
  content: { title: 'Create content', prefix: 'CNT', fields: [
    { key: 'title', label: 'Content title', required: true }, { key: 'platform', label: 'Platform', type: 'select', options: ['Instagram','TikTok','YouTube','Other'].map(x=>({label:x,value:x})) },
    { key: 'pillar', label: 'Content pillar' }, { key: 'format', label: 'Format', type: 'select', options: ['Carousel','Short video','Reels','Stories','YouTube video','Shorts','Static'].map(x=>({label:x,value:x})) },
    { key: 'hook', label: 'Hook', type: 'textarea', wide: true }, { key: 'cta', label: 'CTA' }, { key: 'owner', label: 'Owner' },
    { key: 'status', label: 'Status', type: 'select', options: ['Idea','Brief','Production','Review','Changes Requested','Approved','Scheduled','Published','Evaluated'].map(x=>({label:x,value:x})) },
    { key: 'publishDate', label: 'Publish date', type: 'date' }, { key: 'campaignId', label: 'Campaign', type: 'campaign' }
  ] },
  expense: { title: 'Add expense', prefix: 'EXP', fields: [
    { key: 'title', label: 'Expense name', required: true }, { key: 'category', label: 'Category', type: 'select', options: ['Paid media','KOL','Production','Software','Other'].map(x=>({label:x,value:x})) },
    { key: 'vendor', label: 'Vendor' }, { key: 'amount', label: 'Amount (IDR)', type: 'number', required: true },
    { key: 'date', label: 'Date', type: 'date' }, { key: 'channel', label: 'Channel' },
    { key: 'type', label: 'Cost type', type: 'select', options: [{label:'Actual',value:'actual'},{label:'Committed',value:'committed'}] },
    { key: 'campaignId', label: 'Campaign', type: 'campaign' }
  ] },
  kol: { title: 'Add creator', prefix: 'KOL', fields: [
    { key: 'name', label: 'Creator name', required: true }, { key: 'platform', label: 'Primary platform', type: 'select', options: ['Instagram','TikTok','YouTube'].map(x=>({label:x,value:x})) },
    { key: 'handle', label: 'Handle' }, { key: 'instagramUrl', label: 'Instagram profile URL' }, { key: 'niche', label: 'Niche' },
    { key: 'contact', label: 'Contact' }, { key: 'rate', label: 'Rate card (IDR)', type: 'number' },
    { key: 'stage', label: 'Pipeline stage', type: 'select', options: ['Prospect','Contacted','Negotiation','Deal','Briefed','Draft Review','Approved','Published','Paid','Evaluated'].map(x=>({label:x,value:x})) },
    { key: 'campaignId', label: 'Campaign', type: 'campaign' }, { key: 'publishDate', label: 'Planned publish date', type: 'date' }, { key: 'notes', label: 'Notes', type: 'textarea', wide: true }
  ] },
  order: { title: 'Add order', prefix: 'ORD', fields: [
    { key: 'id', label: 'External order ID', required: true }, { key: 'source', label: 'Source', type: 'select', options: ['Scalev','Lynk.id','Manual','Other'].map(x=>({label:x,value:x})) },
    { key: 'date', label: 'Order date', type: 'date' }, { key: 'status', label: 'Status', type: 'select', options: ['Paid','Pending','Cancelled','Refunded'].map(x=>({label:x,value:x})) },
    { key: 'amount', label: 'Order amount (IDR)', type: 'number', required: true }, { key: 'utm', label: 'UTM / source reference' }, { key: 'campaignId', label: 'Campaign', type: 'campaign' }
  ] },
  brief: { title: 'Create brief', prefix: 'BRF', fields: [
    { key: 'title', label: 'Brief title', required: true }, { key: 'type', label: 'Brief type', type: 'select', options: ['Campaign','Content','Ads','KOL'].map(x=>({label:x,value:x})) },
    { key: 'owner', label: 'Owner' }, { key: 'status', label: 'Status', type: 'select', options: ['Draft','In review','Approved'].map(x=>({label:x,value:x})) },
    { key: 'campaignId', label: 'Campaign', type: 'campaign' }
  ] },
  competitor: { title: 'Track competitor account', prefix: 'CMP', fields: [
    { key: 'name', label: 'Account name', required: true }, { key: 'platform', label: 'Platform', type: 'select', options: ['Instagram','TikTok'].map(x=>({label:x,value:x})) },
    { key: 'handle', label: 'Handle' }, { key: 'url', label: 'Profile URL' }, { key: 'label', label: 'Tracking label' },
    { key: 'status', label: 'Tracking status', type: 'select', options: ['Tracking','Paused'].map(x=>({label:x,value:x})) }, { key: 'notes', label: 'Notes', type: 'textarea', wide: true }
  ] },
  action: { title: 'Create action item', prefix: 'TSK', fields: [
    { key: 'title', label: 'Action item', required: true }, { key: 'owner', label: 'Task owner', required: true }, { key: 'assignee', label: 'PIC', required: true },
    { key: 'priority', label: 'Priority', type: 'select', options: ['Low','Medium','High','Urgent'].map(x=>({label:x,value:x})) },
    { key: 'dueDate', label: 'Due date', type: 'date', required: true }, { key: 'campaignId', label: 'Campaign', type: 'campaign' }
  ] },
  experiment: { title: 'Log Ads experiment', prefix: 'EXP', fields: [
    { key: 'name', label: 'Experiment name', required: true }, { key: 'owner', label: 'Owner', required: true },
    { key: 'hypothesis', label: 'Hypothesis', type: 'textarea', wide: true, required: true },
    { key: 'changeMade', label: 'What changed?', type: 'textarea', wide: true },
    { key: 'primaryMetric', label: 'Primary metric', required: true }, { key: 'successCriteria', label: 'Success criteria', type: 'textarea', wide: true },
    { key: 'status', label: 'Status', type: 'select', options: ['Planned','Running','Completed','Inconclusive','Cancelled'].map(x=>({label:x,value:x})) },
    { key: 'startDate', label: 'Start date', type: 'date' }, { key: 'endDate', label: 'End date', type: 'date' }, { key: 'campaignId', label: 'Campaign', type: 'campaign' }
  ] }
};

function CreateModal({ kind, campaigns, onClose, onSave }: {
  kind: Exclude<ModalKind, null>; campaigns: Campaign[]; onClose: () => void; onSave: (values: Record<string, any>) => void;
}) {
  const config = formConfig[kind];
  const [values, setValues] = useState<Record<string, any>>({
    objective: 'Sales', owner: 'Marketing Lead', startDate: jakartaDateKey(), endDate: '',
    status: (kind === 'task' || kind === 'action') ? 'To Do' : kind === 'content' ? 'Idea' : kind === 'kol' ? 'Prospect' : kind === 'expense' ? 'actual' : kind === 'order' ? 'Paid' : kind === 'brief' ? 'Draft' : kind === 'competitor' ? 'Tracking' : kind === 'experiment' ? 'Planned' : 'Draft',
    priority: 'Medium', dueDate: jakartaDateKey(), publishDate: jakartaDateKey(), date: jakartaDateKey()
  });
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const setValue = (key: string, value: any) => setValues(prev => ({ ...prev, [key]: value }));
  const fields = config.fields.filter(field => field.step === undefined || field.step === step);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const missing = fields.find(field => field.required && !String(values[field.key] ?? '').trim());
    if (missing) { setError(`${missing.label} wajib diisi.`); return; }
    if (kind === 'campaign' && step === 0 && values.startDate && values.endDate && values.endDate < values.startDate) {
      setError('Tanggal akhir campaign tidak boleh sebelum tanggal mulai.'); return;
    }
    if (kind === 'kol' && values.instagramUrl) {
      try { const url = new URL(values.instagramUrl); if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname)) throw new Error(); }
      catch { setError('Masukkan URL profil Instagram yang valid (https://instagram.com/...).'); return; }
    }
    if (kind === 'competitor' && values.url) {
      try { const url = new URL(values.url); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); }
      catch { setError('URL profil harus berupa alamat http/https yang valid.'); return; }
    }
    if ((kind === 'expense' || kind === 'order') && Number(values.amount) < 0) {
      setError('Nominal tidak boleh bernilai negatif.'); return;
    }
    if (kind === 'campaign' && step === 0) { setError(''); setStep(1); return; }
    if (kind === 'campaign') {
      const start = values.startDate || jakartaDateKey();
      onSave({ ...values, startDate: start, targetRevenue: Number(values.targetRevenue || 0), plannedBudget: Number(values.plannedBudget || 0), channels: String(values.channels || '').split(',').map((x:string)=>x.trim()).filter(Boolean) });
    } else {
      onSave({ ...values, amount: Number(values.amount || 0), rate: Number(values.rate || 0), channel: values.channel || 'Unspecified' });
    }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal glass" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-head"><div><span className="eyebrow">WORKSPACE ACTION</span><h2 id="modal-title">{config.title}</h2>{kind === 'campaign' && <p>Step {step + 1} of 2 · {step === 0 ? 'Campaign foundation' : 'Targets & distribution'}</p>}</div><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close"/></button></div>
      <form onSubmit={submit}>
        <div className="form-grid">
          {fields.map(field => <label key={field.key} className={field.wide ? 'field field-wide' : 'field'}>
            <span>{field.label}{field.required && <b> *</b>}</span>
            {field.type === 'textarea' ? <textarea value={values[field.key] ?? ''} onChange={e=>setValue(field.key,e.target.value)} placeholder={field.placeholder || ''} rows={3}/>
              : field.type === 'select' ? <select value={values[field.key] ?? field.options?.[0]?.value ?? ''} onChange={e=>setValue(field.key,e.target.value)}>{field.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : field.type === 'campaign' ? <select value={values[field.key] ?? ''} onChange={e=>setValue(field.key,e.target.value)}><option value="">No linked campaign</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
              : <input type={field.type || 'text'} value={values[field.key] ?? ''} onChange={e=>setValue(field.key,e.target.value)} placeholder={field.placeholder || ''} min={field.type === 'number' ? 0 : undefined}/>
            }
          </label>)}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary">{kind === 'campaign' && step === 0 ? 'Continue' : 'Save record'} <Icon name="arrow" size={15}/></button></div>
      </form>
      {kind === 'campaign' && step > 0 && <button className="floating-back in-modal" onClick={()=>setStep(s=>Math.max(0,s-1))}><Icon name="arrow" size={15}/> Back <span>Campaign foundation</span></button>}
    </div>
  </div>;
}

function App() {
  return <AuthProvider><WorkspaceProvider><AuthenticatedWorkspace /></WorkspaceProvider></AuthProvider>;
}

function AuthenticatedWorkspace() {
  const { session, signOut } = useAuth();
  const { workspace, workspaces, selectWorkspace } = useWorkspace();
  return (
    <WorkspaceApp
      key={workspace.id}
      user={session.user}
      workspace={workspace}
      workspaces={workspaces}
      selectWorkspace={selectWorkspace}
      onSignOut={signOut}
    />
  );
}

function WorkspaceApp({
  user,
  workspace,
  workspaces,
  selectWorkspace,
  onSignOut
}: {
  user: AuthUser;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  selectWorkspace: (id: string) => void;
  onSignOut: () => Promise<void>;
}) {
  const workspaceStorageKey = STORAGE_KEY + ':' + workspace.id;
  const localDataStorageKey = workspaceStorageKey + ':local-v1';
  const migrationMarkerKey = workspaceStorageKey + ':business-api-v1';
  const legacyRawRef = useRef<string | null | undefined>(undefined);
  if (legacyRawRef.current === undefined) {
    try { legacyRawRef.current = localStorage.getItem(workspaceStorageKey); }
    catch { legacyRawRef.current = null; }
  }
  const isOwner = workspace.role === 'owner';
  const [data, setData] = useState<WorkspaceData>(() => createEmptyWorkspaceData());
  const dataRef = useRef(data);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [dataReady, setDataReady] = useState(false);
  const [dataError, setDataError] = useState('');
  const [dataStatus, setDataStatus] = useState('Preparing workspace data');
  const [retryVersion, setRetryVersion] = useState(0);
  const [savingCount, setSavingCount] = useState(0);
  const [page, setPage] = useState<PageId>('overview');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [dateRange, setDateRange] = useState('7D');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [campaignTab, setCampaignTab] = useState('Overview');
  const [globalSearch, setGlobalSearch] = useState('');
  const [adsTab, setAdsTab] = useState<'ads'|'sales'>('ads');
  const [calendarView, setCalendarView] = useState<'Month'|'Week'|'List'>('Week');
  const [calendarAnchor, setCalendarAnchor] = useState(jakartaDateKey());
  const [calendarCampaignFilter, setCalendarCampaignFilter] = useState('all');
  const [calendarChannelFilter, setCalendarChannelFilter] = useState('all');
  const [calendarTypeFilter, setCalendarTypeFilter] = useState('all');
  const [calendarOwnerFilter, setCalendarOwnerFilter] = useState('all');
  const [calendarStatusFilter, setCalendarStatusFilter] = useState('all');
  const [contentFilter, setContentFilter] = useState('All');
  const [online, setOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState('');
  const [importPreview, setImportPreview] = useState<{ type: 'orders'|'ads'; headers: string[]; rows: string[][]; filename: string } | null>(null);
  const restoreInput = useRef<HTMLInputElement | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const initializeWorkspaceData = async () => {
      setDataReady(false);
      setDataError('');
      setDataStatus('Checking local workspace snapshot');

      try {
        let localData: WorkspaceData;
        const marker = localStorage.getItem(migrationMarkerKey);

        if (!marker) {
          const legacy = legacyRawRef.current
            ? parseLegacyWorkspace(legacyRawRef.current)
            : createEmptyWorkspaceData();
          let migration = { imported: 0, skipped: 0 };

          if (legacyRawRef.current) {
            setDataStatus('Migrating existing browser records');
            migration = await migrateLegacyBusinessCollections(workspace.id, legacy, (resource, completed, total) => {
              setDataStatus(`Migrating ${resource} · ${completed}/${total}`);
            });
          }

          localData = legacy;
          localStorage.setItem(localDataStorageKey, JSON.stringify(localOnlyWorkspaceData(localData)));
          localStorage.setItem(migrationMarkerKey, JSON.stringify({
            version: 1,
            completedAt: new Date().toISOString(),
            imported: migration.imported,
            skipped: migration.skipped,
            legacySnapshotPreserved: Boolean(legacyRawRef.current)
          }));
        } else {
          const localRaw = localStorage.getItem(localDataStorageKey);
          if (localRaw) {
            const localParsed = JSON.parse(localRaw) as Partial<WorkspaceData>;
            localData = {
              ...createEmptyWorkspaceData(),
              ...localParsed,
              campaigns: [], tasks: [], contents: [], expenses: [], kols: [],
              briefs: [], experiments: [], competitors: [], competitorPosts: [],
              orders: localParsed.orders ?? [],
              ads: localParsed.ads ?? [],
              notifications: localParsed.notifications ?? [],
              updatedAt: localParsed.updatedAt ?? new Date().toISOString()
            };
          } else if (legacyRawRef.current) {
            localData = parseLegacyWorkspace(legacyRawRef.current);
          } else {
            localData = createEmptyWorkspaceData();
          }
        }

        setDataStatus('Loading workspace records from PostgreSQL');
        const remote = await loadBusinessCollections(workspace.id);
        const next: WorkspaceData = {
          ...createEmptyWorkspaceData(),
          ...remote,
          orders: localData.orders,
          ads: localData.ads,
          notifications: localData.notifications,
          updatedAt: new Date().toISOString()
        };

        if (cancelled) return;
        dataRef.current = next;
        setData(next);
        setDataReady(true);
        setDataStatus('Workspace data is synchronized');
      } catch (error) {
        if (cancelled) return;
        setDataError(error instanceof Error ? error.message : 'Workspace data could not be loaded.');
        setDataStatus('Workspace data needs attention');
      }
    };

    void initializeWorkspaceData();
    return () => { cancelled = true; };
  }, [workspace.id, retryVersion]);

  useEffect(() => {
    if (!dataReady) return;
    try {
      localStorage.setItem(localDataStorageKey, JSON.stringify(localOnlyWorkspaceData(data)));
    } catch {
      setDataError('Browser-local orders, Ads, or notifications could not be saved. Export a JSON backup before continuing.');
    }
  }, [data.orders, data.ads, data.notifications, data.updatedAt, dataReady, localDataStorageKey]);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDrawerOpen(false); setAiOpen(false); setNotificationsOpen(false); if (modal) setModal(null); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  const update = <K extends keyof WorkspaceData,>(key: K, updater: (current: WorkspaceData[K]) => WorkspaceData[K]): Promise<void> => {
    setSavingCount(value => value + 1);
    const operation = mutationQueueRef.current.then(async () => {
      if (!dataReady) throw new Error('Workspace data has not finished loading.');
      const current = dataRef.current;
      const nextValue = updater(current[key]);
      if (BUSINESS_DATA_RESOURCES.some(item => item.key === key)) {
        await persistBusinessCollectionChanges(
          workspace.id,
          key as BusinessDataKey,
          current[key] as WorkspaceData[BusinessDataKey],
          nextValue as WorkspaceData[BusinessDataKey]
        );
      }
      const nextData = { ...current, [key]: nextValue, updatedAt: new Date().toISOString() } as WorkspaceData;
      dataRef.current = nextData;
      setData(nextData);
    });
    mutationQueueRef.current = operation.catch(() => undefined);
    return operation.finally(() => setSavingCount(value => Math.max(0, value - 1)));
  };

  const replaceAllData = (nextData: WorkspaceData): Promise<void> => {
    setSavingCount(value => value + 1);
    const operation = mutationQueueRef.current.then(async () => {
      if (!dataReady) throw new Error('Workspace data has not finished loading.');
      const current = dataRef.current;
      await replaceBusinessCollections(workspace.id, current, nextData);
      const next = { ...nextData, updatedAt: new Date().toISOString() };
      dataRef.current = next;
      setData(next);
    });
    mutationQueueRef.current = operation.catch(() => undefined);
    return operation.finally(() => setSavingCount(value => Math.max(0, value - 1)));
  };

  const notify = (message: string) => setToast(message);
  const navigate = (target: PageId) => {
    if (target === 'access' && !isOwner) { notify('Access Management hanya tersedia untuk Owner.'); return; }
    setPage(target); setDrawerOpen(false); setAiOpen(false); setNotificationsOpen(false); setGlobalSearch('');
  };
  const campaign = selectedCampaign ? data.campaigns.find(c => c.id === selectedCampaign) : undefined;
  const todayIso = jakartaDateKey();
  const jakartaHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const greeting = jakartaHour < 11 ? 'Good morning' : jakartaHour < 15 ? 'Good afternoon' : jakartaHour < 18 ? 'Good evening' : 'Good night';
  const rangeDays = dateRange === '7D' ? 6 : dateRange === '30D' ? 29 : dateRange === '90D' ? 89 : 0;
  const rangeStart = dateRange === 'MTD' ? `${todayIso.slice(0,7)}-01` : addJakartaDays(-rangeDays);
  const inSelectedPeriod = (value?: string) => !!value && value >= rangeStart && value <= todayIso;
  const matchesCampaign = (id?: string) => campaignFilter === 'all' || id === campaignFilter;
  const campaignHasChannel = (id: string | undefined, channel: string) => channel === 'all' || (data.campaigns.find(c=>c.id===id)?.channels || []).some(c=>c.toLowerCase()===channel.toLowerCase());
  const scopedCampaigns = data.campaigns.filter(c=>matchesCampaign(c.id));
  const scopedOrders = data.orders.filter(o=>inSelectedPeriod(o.date)&&matchesCampaign(o.campaignId)&&campaignHasChannel(o.campaignId,channelFilter));
  const scopedAds = data.ads.filter(a=>inSelectedPeriod(a.date)&&matchesCampaign(a.campaignId)&&(channelFilter==='all'||a.platform.toLowerCase()===channelFilter.toLowerCase()));
  const scopedContents = data.contents.filter(c=>inSelectedPeriod(c.publishDate)&&matchesCampaign(c.campaignId)&&(channelFilter==='all'||c.platform.toLowerCase()===channelFilter.toLowerCase()));
  const scopedExpenses = data.expenses.filter(e=>inSelectedPeriod(e.date)&&matchesCampaign(e.campaignId)&&campaignHasChannel(e.campaignId,channelFilter));
  const scopedTasks = data.tasks.filter(t=>matchesCampaign(t.campaignId));
  const revenue = scopedOrders.filter(o=>o.status==='Paid').reduce((sum,o)=>sum+o.amount,0);
  const spend = scopedAds.reduce((sum,a)=>sum+a.spend,0);
  const ordersCount = scopedOrders.filter(o=>o.status==='Paid').length;
  const attributedRevenue = scopedAds.reduce((sum,a)=>sum+(a.attributedRevenue || 0),0);
  const blendedRoas = spend > 0 ? revenue / spend : undefined;
  const budgetPlanned = scopedCampaigns.reduce((sum,c)=>sum+c.plannedBudget,0);
  const budgetCommitted = scopedExpenses.filter(e=>e.type==='committed').reduce((sum,e)=>sum+e.amount,0);
  const budgetActual = scopedExpenses.filter(e=>e.type==='actual').reduce((sum,e)=>sum+e.amount,0) + spend;
  const budgetRemaining = budgetPlanned-budgetCommitted-budgetActual;
  const overdueTasks = scopedTasks.filter(t=>t.status!=='Done' && t.dueDate < todayIso);
  const pendingApproval = scopedTasks.filter(t=>t.status==='Review').length;
  const activeCampaigns = scopedCampaigns.filter(c=>c.status==='Active');

  const pageMeta = page === 'campaign-detail' ? pageTitles['campaign-detail'] : pageTitles[page];
  const openCreate = (kind: Exclude<ModalKind,null>) => setModal(kind);
  const openCampaign = (id: string) => { setSelectedCampaign(id); setCampaignTab('Overview'); navigate('campaign-detail'); };
  const createRecord = (values: Record<string, any>) => {
    switch (modal) {
      case 'campaign': {
        const next: Campaign = { id: makeId('CAM', data.campaigns.length, data.campaigns.map(c=>c.id)), name: values.name, objective: values.objective, owner: values.owner, startDate: values.startDate, endDate: values.endDate, targetRevenue: values.targetRevenue, plannedBudget: values.plannedBudget, channels: values.channels, status: values.status };
        update('campaigns', curr => [next, ...curr]); notify('Campaign berhasil disimpan di perangkat ini.'); break;
      }
      case 'task': case 'action': {
        const next: Task = { id: makeId('TSK', data.tasks.length, data.tasks.map(t=>t.id)), title: values.title, description: values.description, owner: values.owner || 'Marketing Lead', assignee: values.assignee, priority: values.priority || 'Medium', status: values.status || 'To Do', dueDate: values.dueDate, campaignId: values.campaignId };
        update('tasks', curr => [next, ...curr]); notify('Task berhasil dibuat.'); break;
      }
      case 'content': {
        const next: ContentItem = { id: makeId('CNT', data.contents.length, data.contents.map(c=>c.id)), title: values.title, platform: values.platform, pillar: values.pillar, format: values.format, hook: values.hook, cta: values.cta, owner: values.owner, status: values.status, publishDate: values.publishDate, campaignId: values.campaignId, views: 0, engagement: 0 };
        update('contents', curr => [next, ...curr]); notify('Content record berhasil dibuat.'); break;
      }
      case 'expense': {
        const next: Expense = { id: makeId('EXP', data.expenses.length, data.expenses.map(e=>e.id)), title: values.title, category: values.category, vendor: values.vendor, amount: values.amount, date: values.date, channel: values.channel, type: values.type, campaignId: values.campaignId };
        update('expenses', curr => [next, ...curr]); notify('Expense berhasil dicatat.'); break;
      }
      case 'kol': {
        const next: Kol = { id: makeSequentialId('KOL', data.kols.map(k=>k.id), 5), name: values.name, platform: values.platform, handle: values.handle, instagramUrl: values.instagramUrl, niche: values.niche, contact: values.contact, rate: values.rate, stage: values.stage, campaignId: values.campaignId, publishDate: values.publishDate || undefined, notes: values.notes };
        update('kols', curr => [next, ...curr]); notify('Creator berhasil ditambahkan.'); break;
      }
      case 'order': {
        const exists = data.orders.some(o=>o.id===values.id);
        if (exists) { notify('Order ID sudah ada. Record duplikat ditolak.'); break; }
        const next: Order = { id: values.id, source: values.source, date: values.date, status: values.status, amount: values.amount, utm: values.utm, campaignId: values.campaignId };
        update('orders', curr => [next, ...curr]); notify('Order berhasil dicatat.'); break;
      }
      case 'brief': {
        const next: Brief = { id: makeSequentialId('BRF', data.briefs.map(b=>b.id), 4), title: values.title, type: values.type, campaignId: values.campaignId, status: values.status, owner: values.owner, updatedAt: jakartaDateKey() };
        update('briefs', curr => [next, ...curr]); notify('Brief berhasil dibuat.'); break;
      }
      case 'experiment': {
        const next: Experiment = { id: makeSequentialId('EXP-TEST', data.experiments.map(e=>e.id), 3), name: values.name, hypothesis: values.hypothesis, changeMade: values.changeMade, primaryMetric: values.primaryMetric, successCriteria: values.successCriteria, owner: values.owner, status: values.status || 'Planned', startDate: values.startDate, endDate: values.endDate, campaignId: values.campaignId };
        update('experiments', curr => [next, ...curr]); notify('Experiment log berhasil dibuat.'); break;
      }
      case 'competitor': {
        const next: Competitor = { id: makeSequentialId('CMP', data.competitors.map(c=>c.id), 4), name: values.name, platform: values.platform, handle: values.handle, url: values.url, label: values.label, notes: values.notes, status: values.status };
        update('competitors', curr => [next, ...curr]); notify('Akun kompetitor ditambahkan. Hanya data publik/manual yang didukung.'); break;
      }
    }
    setModal(null);
  };

  const updateTaskStatus = (id: string, status: string) => update('tasks', curr => curr.map(t=>t.id===id?{...t,status}:t));
  const updateContentStatus = (id: string, status: string) => update('contents', curr => curr.map(c=>c.id===id?{...c,status}:c));
  const removeRecord = (type: 'campaigns'|'tasks'|'contents'|'expenses'|'kols'|'orders'|'briefs'|'competitors', id: string) => {
    const names: Record<string,string> = { campaigns:'Campaign',tasks:'Task',contents:'Content',expenses:'Expense',kols:'Creator',orders:'Order',briefs:'Brief',competitors:'Competitor' };
    if (!window.confirm(`Hapus ${names[type]} ${id}? Data lokal akan dihapus dari workspace demo.`)) return;
    update(type, (curr: any) => curr.filter((item: any)=>item.id!==id) as any); notify(`${names[type]} dihapus dari data lokal.`);
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString(), format: 'nexus-local-backup-v1' }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `nexus-backup-${jakartaDateKey()}.json`); notify('Backup JSON berhasil diekspor.');
  };
  const exportCSV = (records: Record<string, any>[], filename: string) => {
    if (!records.length) { notify('Tidak ada data untuk diekspor.'); return; }
    const headers = Object.keys(records[0]);
    const csv = [headers.join(','), ...records.map(row=>headers.map(k=>csvEscape(row[k])).join(','))].join('\n');
    downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}), filename); notify('CSV berhasil diekspor.');
  };
  const startRestore = () => restoreInput.current?.click();
  const handleRestoreFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const restored = parsed.data || parsed;
      if (!Array.isArray(restored.campaigns) || !Array.isArray(restored.tasks) || !Array.isArray(restored.orders)) throw new Error('Format backup tidak dikenali.');
      if (!window.confirm('Ganti seluruh data lokal saat ini dengan isi backup?')) return;
      setData({ ...demoData, ...restored, updatedAt: new Date().toISOString() }); notify('Backup berhasil dipulihkan ke penyimpanan lokal.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Backup tidak dapat dibaca.'); }
  };

  const handleCsvFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (parsed.length < 2) throw new Error('CSV tidak berisi baris data.');
      const headers = parsed[0].map(x=>x.replace(/^\uFEFF/, '').trim());
      const rows = parsed.slice(1).filter(row=>row.some(cell=>cell.trim()));
      const normalized = headers.map(h=>h.toLowerCase().replace(/[^a-z0-9]/g,''));
      const looksOrders = normalized.some(h=>['orderid','externalorderid','transactionid'].includes(h)) && normalized.some(h=>['amount','total','revenue','grossrevenue'].includes(h));
      setImportPreview({ type: looksOrders ? 'orders' : 'ads', headers, rows: rows.slice(0,8), filename: file.name });
      (window as any).__nexusCSVRows = rows;
    } catch (error) { notify(error instanceof Error ? error.message : 'CSV gagal dibaca.'); }
  };
  const confirmCSVImport = () => {
    if (!importPreview) return;
    const rows: string[][] = (window as any).__nexusCSVRows || [];
    const key = (name: string) => importPreview!.headers.findIndex(h=>h.toLowerCase().replace(/[^a-z0-9]/g,'')===name);
    const pick = (row: string[], names: string[], fallback = '') => {
      const index = names.map(key).find(i=>i>=0);
      return index === undefined ? fallback : row[index] ?? fallback;
    };
    if (importPreview.type === 'orders') {
      let added = 0, skipped = 0;
      const imported: Order[] = [];
      const seenIds = new Set(data.orders.map(order => order.id));
      rows.forEach((row, i) => {
        const id = pick(row, ['orderid', 'externalorderid', 'transactionid'], '').trim();
        const date = parseIsoDateKey(pick(row, ['date', 'orderdate', 'createdat'], ''));
        const amount = parseCsvNumber(pick(row, ['amount', 'total', 'revenue', 'grossrevenue'], ''));
        if (!id || !date || amount === undefined || amount < 0 || seenIds.has(id)) { skipped++; return; }
        seenIds.add(id);
        imported.push({ id, source: pick(row, ['source', 'platform'], 'CSV import'), date, status: pick(row, ['status', 'paymentstatus'], 'Paid'), amount, utm: pick(row, ['utm', 'sourcecampaign', 'campaign']), campaignId: undefined });
        added++;
      });
      update('orders', curr => [...imported, ...curr]); notify(`Import selesai: ${added} order ditambahkan, ${skipped} dilewati/duplikat/invalid.`);
    } else {
      let added = 0, skipped = 0;
      const imported: AdMetric[] = [];
      const fingerprints = new Set(data.ads.map(ad => [ad.date, ad.campaignName, ad.platform, ad.spend, ad.impressions, ad.clicks, ad.purchases].join('|')));
      const seenExternalIds = new Set(data.ads.map(ad => ad.id));
      rows.forEach((row, i) => {
        const spend = parseCsvNumber(pick(row, ['spend', 'amountspent', 'cost'], ''));
        const impressions = parseCsvNumber(pick(row, ['impressions'], ''));
        if (spend === undefined || impressions === undefined || spend < 0 || impressions < 0) { skipped++; return; }
        const date = parseIsoDateKey(pick(row, ['date', 'metricdate', 'datestart'], ''));
        if (!date) { skipped++; return; }
        const campaignName = pick(row, ['campaignname', 'campaign'], 'CSV import');
        const platform = pick(row, ['platform', 'source'], 'Meta Ads');
        const clicks = parseCsvNumber(pick(row, ['linkclicks', 'clicks'], '0')) ?? 0;
        const purchases = parseCsvNumber(pick(row, ['purchases', 'results'], '0')) ?? 0;
        const externalId = pick(row, ['recordid', 'adid', 'adsetid'], '').trim();
        const id = externalId ? `ADS-${externalId}` : `CSV-ADS-${Date.now()}-${i}`;
        const fingerprint = [date, campaignName, platform, spend, impressions, clicks, purchases].join('|');
        if ((externalId && seenExternalIds.has(id)) || (!externalId && fingerprints.has(fingerprint))) { skipped++; return; }
        seenExternalIds.add(id); fingerprints.add(fingerprint);
        imported.push({ id, date, campaignName, platform, spend, impressions, reach: parseCsvNumber(pick(row, ['reach'], '')),
          clicks, lpv: parseCsvNumber(pick(row, ['landingpageviews', 'lpv'], '')),
          atc: parseCsvNumber(pick(row, ['addtocart', 'atc'], '')),
          checkout: parseCsvNumber(pick(row, ['initiatecheckout', 'checkout', 'ic'], '')),
          purchases, attributedRevenue: parseCsvNumber(pick(row, ['attributedrevenue', 'revenue'], '')),
          source: 'CSV import' });
        added++;
      });
      update('ads', curr => [...imported, ...curr]); notify(`Import selesai: ${added} baris Ads ditambahkan, ${skipped} dilewati/duplikat/invalid.`);
    }
    setImportPreview(null); delete (window as any).__nexusCSVRows;
  };

  const totalRevenueText = rupiah(revenue);
  const activePage = pageMeta.title;
  const searchResults = globalSearch.trim().length > 1 ? [
    ...data.campaigns.filter(c=>c.name.toLowerCase().includes(globalSearch.toLowerCase())).map(c=>({label:c.name, detail:c.id, page:'campaigns' as PageId, id:c.id})),
    ...data.tasks.filter(t=>t.title.toLowerCase().includes(globalSearch.toLowerCase())).map(t=>({label:t.title, detail:t.id, page:'tasks' as PageId, id:t.id})),
    ...data.contents.filter(c=>c.title.toLowerCase().includes(globalSearch.toLowerCase())).map(c=>({label:c.title, detail:c.id, page:'content' as PageId, id:c.id}))
  ].slice(0,7) : [];

  const renderSidebar = (mobile = false) => <>
    <div className="brand-row"><div className="brand-mark">N</div><div><strong>NEXUS</strong><span>MARKETING INTELLIGENCE</span></div><button className="icon-btn drawer-close" onClick={()=>setDrawerOpen(false)} aria-label="Close menu"><Icon name="close"/></button></div>
    <div className="workspace-chip"><span className="workspace-orb"/><div className="workspace-chip-copy"><strong>{workspace.name}</strong><small>{workspaces.length} workspace · {workspace.role === 'owner' ? 'Owner' : 'Member'}</small></div>{workspaces.length > 1 && <select className="workspace-switcher" aria-label="Switch workspace" value={workspace.id} onChange={event => selectWorkspace(event.target.value)}>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<Icon name="chevron" size={14}/></div>
    <nav className="side-nav" aria-label="Main navigation">
      {navGroups.map(group=><div className="nav-group" key={group.title}>
        <div className="nav-group-title">{group.title}</div>
        {group.items.filter(item=>item.id!=='access'||isOwner).map(item=><button key={item.id} className={`nav-item ${page===item.id?'active':''}`} onClick={()=>navigate(item.id)}>
          <Icon name={item.icon}/><span>{item.label}</span>{item.id==='tasks' && overdueTasks.length>0 && <em>{overdueTasks.length}</em>}
        </button>)}
      </div>)}
    </nav>
    <div className="sidebar-footer">
      <div className="sync-mini"><span className="pulse-dot"/><div><strong>{online?'Workspace online':'Offline snapshot'}</strong><small>Local data · {new Date(data.updatedAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</small></div></div>
      <div className="sidebar-profile"><div className="avatar">{(user.email || user.id).slice(0,1).toUpperCase()}</div><div><strong>{user.email || 'Authenticated user'}</strong><small>{workspace.role === 'owner' ? 'Owner' : 'Member'} · Server verified</small></div></div>
    </div>
  </>;

  const renderHeader = () => <header className="topbar">
    <div className="topbar-left"><button className="icon-btn mobile-menu" onClick={()=>setDrawerOpen(true)} aria-label="Open navigation"><Icon name="menu"/></button><div className="breadcrumbs"><span>{pageMeta.phase}</span><b>/</b><strong>{activePage}</strong></div></div>
    <div className="topbar-actions">
      <div className="global-search"><Icon name="search" size={16}/><input value={globalSearch} onChange={e=>setGlobalSearch(e.target.value)} placeholder="Search anything..." aria-label="Search workspace"/><kbd>⌘ K</kbd>
        {searchResults.length>0 && <div className="search-results">{searchResults.map(result=><button key={result.detail} onClick={()=>{navigate(result.page); if(result.page==='campaigns') setSelectedCampaign(result.id);}}><span>{result.label}</span><small>{result.detail}</small></button>)}</div>}
      </div>
      <button className="icon-btn notification-trigger" onClick={()=>setNotificationsOpen(v=>!v)} aria-label="Notifications"><Icon name="bell"/>{data.notifications.length>0&&<i/>}</button>
      <button className="ai-top-trigger" onClick={()=>setAiOpen(true)}><span className="ai-orb-mini"><Icon name="sparkles" size={14}/></span><span>Ask NEXUS</span></button>
      <SessionControls user={user} role={workspace.role} workspaceName={workspace.name} onSignOut={onSignOut}/>
    </div>
    {notificationsOpen && <div className="notification-popover glass"><div className="popover-title"><strong>Notifications</strong><button className="text-btn" onClick={()=>update('notifications',()=>[])}>Clear all</button></div>{data.notifications.length ? data.notifications.map(n=><div className="notification-item" key={n.id}><span className={`notification-dot ${n.level}`}/><div><strong>{n.title}</strong><p>{n.detail}</p><small>{n.time}</small></div></div>) : <Empty title="You're all caught up" body="Tidak ada notifikasi baru."/>}</div>}
  </header>;

  const renderOverview = () => <>
    <div className="overview-intro"><div><span className="eyebrow">{new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'2-digit',month:'long',year:'numeric',timeZone:'Asia/Jakarta'}).format(new Date()).toUpperCase()}</span><h1>{greeting}, team <span>✦</span></h1><p>Ini ringkasan yang perlu kamu lihat sebelum mengambil keputusan hari ini.</p></div><div className="intro-actions"><select className="period-select" value={dateRange} onChange={e=>setDateRange(e.target.value)}><option value="7D">Last 7 days</option><option value="30D">Last 30 days</option><option value="90D">Last 90 days</option><option value="MTD">This month</option></select><select className="period-select" value={campaignFilter} onChange={e=>setCampaignFilter(e.target.value)}><option value="all">All campaigns</option>{data.campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select className="period-select" value={channelFilter} onChange={e=>setChannelFilter(e.target.value)}><option value="all">All channels</option>{['Meta Ads','Instagram','TikTok','YouTube','KOL','Content'].map(c=><option key={c} value={c}>{c}</option>)}</select><button className="btn btn-primary" onClick={()=>openCreate('campaign')}><Icon name="plus" size={15}/> New campaign</button></div></div>
    <div className="metric-grid">
      <MetricCard label="Total revenue" value={totalRevenueText} detail="Paid orders · demo data" icon="wallet" tone="mint"/>
      <MetricCard label="Orders" value={String(ordersCount)} detail="Paid status only" icon="layers" tone="blue"/>
      <MetricCard label="Ad spend" value={rupiah(spend)} detail="Meta Ads · imported demo" icon="chart" tone="amber"/>
      <MetricCard label="Blended ROAS" value={blendedRoas===undefined?'N/A':`${blendedRoas.toFixed(2)}x`} detail="Revenue / paid spend" icon="activity" tone="violet"/>
      <MetricCard label="Content views" value={compactNumber(scopedContents.reduce((s,c)=>s+(c.views||0),0))} detail="Available snapshots" icon="image" tone="blue"/>
      <MetricCard label="Engagement rate" value={scopedContents.some(c=>c.engagement)?`${(scopedContents.filter(c=>c.engagement).reduce((s,c)=>s+(c.engagement||0),0)/scopedContents.filter(c=>c.engagement).length).toFixed(1)}%`:'N/A'} detail="Available content only" icon="sparkles" tone="mint"/>
    </div>
    <div className="overview-grid top-grid">
      <Panel title="Performance trajectory" action={<div className="legend"><span><i className="legend-violet"/>Revenue</span><span><i className="legend-blue"/>Ad spend</span><Badge tone="info">DEMO SERIES</Badge></div>}>
        <div className="chart-summary"><strong>{rupiah(revenue)}</strong><span>Recorded paid revenue <b className="positive">+12.8%</b></span></div><TrendChart/>
      </Panel>
      <Panel title="Channel pulse" action={<button className="text-btn" onClick={()=>navigate('analytics')}>View analytics <Icon name="arrow" size={13}/></button>}>
        <div className="channel-list">
          {[{name:'Meta Ads',meta:`${rupiah(spend)}`,detail:'Spend · demo import',tone:'violet',status:'stale'},{name:'Instagram',meta:'24.8K',detail:'Views · sample snapshot',tone:'pink',status:'unavailable'},{name:'TikTok',meta:'N/A',detail:'Awaiting official connector',tone:'blue',status:'unavailable'},{name:'YouTube',meta:'N/A',detail:'Awaiting official connector',tone:'red',status:'unavailable'}].map(c=><div className="channel-row" key={c.name}><div className={`channel-logo channel-${c.tone}`}>{c.name==='Meta Ads'?'M':c.name==='Instagram'?'◎':c.name==='TikTok'?'♪':'▶'}</div><div className="channel-info"><strong>{c.name}</strong><small>{c.detail}</small></div><div className="channel-metric"><b>{c.meta}</b><small>{c.status==='stale'?'Last import: demo': 'Not connected'}</small></div></div>)}
        </div>
      </Panel>
    </div>
    <div className="overview-grid mid-grid">
      <Panel title="Sales funnel" action={<Badge tone="info">MANUAL / DEMO</Badge>}>
        <div className="funnel-list">{[
          {label:'Landing page visits',value:921,rate:'100%',width:100,tone:'violet'},
          {label:'Add to cart',value:154,rate:'16.7%',width:66,tone:'blue'},
          {label:'Initiate checkout',value:45,rate:'4.9%',width:39,tone:'cyan'},
          {label:'Purchases',value:ordersCount,rate:`${(ordersCount/921*100).toFixed(1)}%`,width:19,tone:'mint'}
        ].map(item=><div className="funnel-item" key={item.label}><div className="funnel-label"><span>{item.label}</span><strong>{item.value.toLocaleString('id-ID')} <small>{item.rate}</small></strong></div><Progress value={item.width} tone={item.tone}/></div>)}</div>
        <p className="panel-footnote">Visits dan tahapan funnel merupakan seed demo; bukan sinkronisasi Scalev/Lynk.id.</p>
      </Panel>
      <Panel title="Budget pacing" action={<button className="text-btn" onClick={()=>navigate('budget')}>Open budget <Icon name="arrow" size={13}/></button>}>
        <div className="budget-summary"><div><small>Planned budget</small><strong>{rupiah(budgetPlanned)}</strong></div><Badge tone={budgetRemaining>0?'success':'warning'}>{budgetPlanned?Math.round((budgetActual+budgetCommitted)/budgetPlanned*100):0}% utilized</Badge></div>
        <Progress value={budgetPlanned?((budgetActual+budgetCommitted)/budgetPlanned*100):0}/>
        <div className="budget-legend"><div><i className="dot-violet"/><span>Actual</span><b>{rupiah(budgetActual)}</b></div><div><i className="dot-blue"/><span>Committed</span><b>{rupiah(budgetCommitted)}</b></div><div><i className="dot-muted"/><span>Remaining</span><b>{rupiah(budgetRemaining)}</b></div></div>
      </Panel>
    </div>
    <div className="overview-grid bottom-grid">
      <Panel title="Campaigns in motion" action={<button className="text-btn" onClick={()=>navigate('campaigns')}>All campaigns <Icon name="arrow" size={13}/></button>}>
        <div className="campaign-mini-list">{activeCampaigns.length ? activeCampaigns.map(c=>{
          const spent = data.expenses.filter(e=>e.campaignId===c.id).reduce((s,e)=>s+e.amount,0)+data.ads.filter(a=>a.campaignId===c.id).reduce((s,a)=>s+a.spend,0);
          return <button className="campaign-mini" key={c.id} onClick={()=>openCampaign(c.id)}><div className="campaign-mini-head"><div><strong>{c.name}</strong><small>{c.id} · {c.objective}</small></div><Badge tone="success">{c.status}</Badge></div><div className="campaign-mini-foot"><span>{rupiah(spent)} / {rupiah(c.plannedBudget)}</span><span>{c.channels.join(' · ')}</span></div><Progress value={c.plannedBudget?spent/c.plannedBudget*100:0}/></button>;
        }) : <Empty title="No active campaigns" body="Buat campaign baru untuk memulai." action={<button className="btn btn-secondary" onClick={()=>openCreate('campaign')}>Create campaign</button>}/>}</div>
      </Panel>
      <Panel title="Needs your attention" action={<button className="text-btn" onClick={()=>navigate('tasks')}>Task board <Icon name="arrow" size={13}/></button>}>
        <div className="attention-list">
          {overdueTasks.slice(0,2).map(task=><button className="attention-item" key={task.id} onClick={()=>navigate('tasks')}><span className="attention-icon warning"><Icon name="clock" size={15}/></span><div><strong>{task.title}</strong><small>Overdue · {task.assignee}</small></div><Badge tone="warning">Overdue</Badge></button>)}
          {data.tasks.filter(t=>t.status==='Review').slice(0,2).map(task=><button className="attention-item" key={task.id} onClick={()=>navigate('tasks')}><span className="attention-icon info"><Icon name="check-square" size={15}/></span><div><strong>{task.title}</strong><small>Approval pending · {task.assignee}</small></div><Badge tone="info">Review</Badge></button>)}
          {!overdueTasks.length && !pendingApproval && <Empty title="Nothing urgent" body="Prioritas utama sudah tertangani."/>}
        </div>
      </Panel>
      <Panel title="Content radar" action={<button className="text-btn" onClick={()=>navigate('content')}>Content studio <Icon name="arrow" size={13}/></button>}>
        <div className="radar-list">{scopedContents.filter(c=>c.status==='Published').sort((a,b)=>(b.views||0)-(a.views||0)).slice(0,3).map((c,i)=><div className="radar-row" key={c.id}><span className="rank">0{i+1}</span><div><strong>{c.title}</strong><small>{c.platform} · {c.format}</small></div><b>{compactNumber(c.views)}</b></div>)}</div>
      </Panel>
      <Panel title="KOL & creator pulse" action={<button className="text-btn" onClick={()=>navigate('kol')}>Open CRM <Icon name="arrow" size={13}/></button>}>
        <div className="kol-pulse"><div className="kol-avatars">{data.kols.slice(0,3).map((k,i)=><span key={k.id} className={`avatar avatar-${i}`}>{k.name.slice(0,1)}</span>)}</div><strong>{data.kols.length} creators tracked</strong><small>{data.kols.filter(k=>['Negotiation','Deal','Briefed'].includes(k.stage)).length} active pipeline collaborations</small><div className="pipeline-mini">{['Prospect','Negotiation','Briefed','Published'].map(stage=><span key={stage}><i/>{stage}<b>{data.kols.filter(k=>k.stage===stage).length}</b></span>)}</div></div>
      </Panel>
    </div>
    <div className="overview-grid final-grid"><Panel title="NEXUS intelligence" className="intelligence-panel"><div className="intelligence-content"><div className="intelligence-orb"><Icon name="sparkles" size={22}/></div><div><Badge tone="info">RULE-BASED DEMO</Badge><h3>{overdueTasks.length ? 'Ada hambatan operasional yang perlu dibereskan.' : 'Ritme operasional terlihat stabil.'}</h3><p>{overdueTasks.length ? `${overdueTasks.length} task melewati deadline. Selesaikan rekonsiliasi data sebelum menarik kesimpulan performa campaign.` : 'Lanjutkan monitoring channel dan kelengkapan data campaign.'}</p><button className="text-btn" onClick={()=>navigate('ai-lab')}>Open Insight Lab <Icon name="arrow" size={13}/></button></div></div></Panel>
      <Panel title="Sync health" action={<button className="text-btn" onClick={()=>navigate('integrations')}>Manage <Icon name="arrow" size={13}/></button>}>
        <div className="sync-health-list">{[{name:'Meta Ads',status:'stale' as const,detail:'CSV / demo sample'},{name:'Scalev',status:'unavailable' as const,detail:'Not configured'},{name:'Lynk.id',status:'unavailable' as const,detail:'Not configured'},{name:'Google Drive',status:'planned' as const,detail:'Backup connector pending'}].map(s=><div key={s.name}><div><strong>{s.name}</strong><small>{s.detail}</small></div><StatusDot status={s.status}/></div>)}</div>
      </Panel></div>
  </>;

  const renderCampaigns = () => <>
    <SectionTitle title="Campaign master" eyebrow={`${data.campaigns.length} RECORDS`} action={<button className="btn btn-primary" onClick={()=>openCreate('campaign')}><Icon name="plus" size={15}/> New campaign</button>}/>
    <div className="summary-strip"><div><small>Active campaigns</small><strong>{activeCampaigns.length}</strong></div><div><small>Total planned budget</small><strong>{rupiah(budgetPlanned)}</strong></div><div><small>Draft / planned</small><strong>{data.campaigns.filter(c=>['Draft','Planned'].includes(c.status)).length}</strong></div><div><small>Completed</small><strong>{data.campaigns.filter(c=>c.status==='Completed').length}</strong></div></div>
    <Panel><div className="table-wrap"><table><thead><tr><th>Campaign</th><th>Objective</th><th>Owner</th><th>Timeline</th><th>Planned budget</th><th>Status</th><th/></tr></thead><tbody>{data.campaigns.map(c=><tr key={c.id}><td><button className="table-primary" onClick={()=>openCampaign(c.id)}>{c.name}<small>{c.id}</small></button></td><td>{c.objective}</td><td>{c.owner}</td><td>{shortDate(c.startDate)} — {shortDate(c.endDate)}</td><td>{rupiah(c.plannedBudget)}</td><td><Badge tone={c.status==='Active'?'success':c.status==='Completed'?'neutral':c.status==='Paused'?'warning':'info'}>{c.status}</Badge></td><td><button className="icon-btn small" onClick={()=>openCampaign(c.id)} aria-label="Open campaign"><Icon name="arrow" size={15}/></button></td></tr>)}</tbody></table></div>{!data.campaigns.length&&<Empty title="Belum ada campaign" body="Mulai dengan membuat Campaign ID pertama." action={<button className="btn btn-primary" onClick={()=>openCreate('campaign')}>Create campaign</button>}/>}</Panel>
    <div className="helper-row"><span><Icon name="info" size={14}/> Campaign archived sebaiknya dipertahankan sebagai histori dan menjadi read-only saat backend tersedia.</span></div>
  </>;

  const renderCampaignDetail = () => {
    if (!campaign) {
      return (
        <Empty
          title="Campaign tidak ditemukan"
          body="Campaign mungkin sudah dihapus dari data lokal."
          action={
            <button className="btn btn-secondary" onClick={() => navigate('campaigns')}>
              Back to campaigns
            </button>
          }
        />
      );
    }
    const linkedTasks = data.tasks.filter(t=>t.campaignId===campaign.id);
    const linkedContents = data.contents.filter(c=>c.campaignId===campaign.id);
    const linkedKols = data.kols.filter(k=>k.campaignId===campaign.id);
    const linkedExpenses = data.expenses.filter(e=>e.campaignId===campaign.id);
    const linkedAds = data.ads.filter(a=>a.campaignId===campaign.id);
    const spent = linkedExpenses.reduce((s,e)=>s+e.amount,0)+linkedAds.reduce((s,a)=>s+a.spend,0);
    const tabs = ['Overview','Brief','Tasks','Timeline','Content','Ads','KOL','Budget','Results'];
    return <>
      <div className="campaign-detail-head"><div><button className="back-link" onClick={()=>navigate('campaigns')}>← All campaigns</button><div className="eyebrow">{campaign.id}</div><h1>{campaign.name}</h1><p>{campaign.objective} · {campaign.owner} · {shortDate(campaign.startDate)} — {shortDate(campaign.endDate)}</p></div><Badge tone={campaign.status==='Active'?'success':'info'}>{campaign.status}</Badge></div>
      <div className="tab-bar">{tabs.map(tab=><button key={tab} className={campaignTab===tab?'selected':''} onClick={()=>setCampaignTab(tab)}>{tab}</button>)}</div>
      {campaignTab==='Overview'&&<><div className="metric-grid four"><MetricCard label="Target revenue" value={rupiah(campaign.targetRevenue)} detail="Campaign target" icon="wallet"/><MetricCard label="Planned budget" value={rupiah(campaign.plannedBudget)} detail="Budget plan" icon="chart" tone="blue"/><MetricCard label="Tracked spend" value={rupiah(spent)} detail="Ads + ledger" icon="activity" tone="amber"/><MetricCard label="Tasks completed" value={`${linkedTasks.filter(t=>t.status==='Done').length}/${linkedTasks.length}`} detail="Task delivery" icon="check-square" tone="mint"/></div><div className="content-two-col"><Panel title="Campaign context"><dl className="detail-list"><div><dt>Channels</dt><dd>{campaign.channels.join(' · ')||'N/A'}</dd></div><div><dt>Objective</dt><dd>{campaign.objective}</dd></div><div><dt>Owner</dt><dd>{campaign.owner}</dd></div><div><dt>Period</dt><dd>{campaign.startDate} — {campaign.endDate}</dd></div><div><dt>Remaining plan</dt><dd>{rupiah(campaign.plannedBudget-spent)}</dd></div></dl></Panel><Panel title="Linked activity"><div className="activity-summary"><div><strong>{linkedTasks.length}</strong><small>Tasks</small></div><div><strong>{linkedContents.length}</strong><small>Content</small></div><div><strong>{linkedKols.length}</strong><small>KOL</small></div><div><strong>{linkedAds.length}</strong><small>Ads records</small></div></div><p className="panel-footnote">Setiap relasi menggunakan Campaign ID untuk menjaga konteks dan data lineage.</p></Panel></div></>}
      {campaignTab==='Brief'&&<Panel title="Campaign briefs" action={<button className="btn btn-secondary" onClick={()=>openCreate('brief')}><Icon name="plus" size={14}/> Add brief</button>}><div className="simple-list">{data.briefs.filter(b=>b.campaignId===campaign.id).map(b=><div key={b.id}><span className="list-icon"><Icon name="file"/></span><div><strong>{b.title}</strong><small>{b.id} · {b.type} · {b.owner}</small></div><Badge tone={b.status==='Approved'?'success':'info'}>{b.status}</Badge></div>)}</div></Panel>}
      {campaignTab==='Tasks'&&<Panel title="Campaign tasks" action={<button className="btn btn-secondary" onClick={()=>openCreate('task')}><Icon name="plus" size={14}/> Add task</button>}><TaskList tasks={linkedTasks} onChange={updateTaskStatus}/></Panel>}
      {campaignTab==='Timeline'&&<Panel title="Timeline"><div className="timeline-list">{[...linkedTasks.map(t=>({date:t.dueDate,title:t.title,tag:'Task'})),...linkedContents.map(c=>({date:c.publishDate,title:c.title,tag:'Content'}))].sort((a,b)=>a.date.localeCompare(b.date)).map((item,i)=><div key={i} className="timeline-item"><span className="timeline-date">{shortDate(item.date)}</span><i/><div><strong>{item.title}</strong><small>{item.tag}</small></div></div>)}</div></Panel>}
      {campaignTab==='Content'&&<Panel title="Campaign content" action={<button className="btn btn-secondary" onClick={()=>openCreate('content')}><Icon name="plus" size={14}/> Add content</button>}><ContentTable content={linkedContents} onStatus={updateContentStatus}/></Panel>}
      {campaignTab==='Ads'&&<Panel title="Ads records"><AdTable ads={linkedAds}/></Panel>}
      {campaignTab==='KOL'&&<Panel title="Creator collaborations"><KolTable kols={linkedKols}/></Panel>}
      {campaignTab==='Budget'&&<Panel title="Budget ledger"><ExpenseTable expenses={linkedExpenses}/></Panel>}
      {campaignTab==='Results'&&<div className="content-two-col"><Panel title="Performance records"><div className="summary-list"><div><span>Actual paid revenue</span><strong>{rupiah(data.orders.filter(o=>o.campaignId===campaign.id&&o.status==='Paid').reduce((s,o)=>s+o.amount,0))}</strong></div><div><span>Ads attributed revenue</span><strong>{rupiah(linkedAds.reduce((s,a)=>s+(a.attributedRevenue||0),0))}</strong></div><div><span>Paid orders</span><strong>{data.orders.filter(o=>o.campaignId===campaign.id&&o.status==='Paid').length}</strong></div></div></Panel><Panel title="Data quality"><Badge tone="warning">Partial demo data</Badge><p className="panel-footnote">Actual sales and Ads-attributed revenue dipisah. Jangan menjumlahkan keduanya tanpa metodologi rekonsiliasi.</p></Panel></div>}
    </>;
  };

  const renderBriefs = () => <><SectionTitle title="Brief library" eyebrow="TEMPLATES & RECORDS" action={<button className="btn btn-primary" onClick={()=>openCreate('brief')}><Icon name="plus" size={15}/> New brief</button>}/><div className="brief-template-grid">{[{type:'Campaign brief',description:'Objective, audience, proposition, offer, message, CTA, KPI, budget, timeline, owner',icon:'layers'},{type:'Content brief',description:'Pillar, angle, hook, message, format, reference, CTA, deadline, publish date',icon:'image'},{type:'Ads brief',description:'Objective, audience, destination, event, creative angle, budget, KPI, hypothesis',icon:'chart'},{type:'KOL brief',description:'Product info, deliverables, talking points, CTA, timeline, revision, usage rights',icon:'users'}].map(t=><div className="brief-template" key={t.type}><span><Icon name={t.icon}/></span><h3>{t.type}</h3><p>{t.description}</p><button className="text-btn" onClick={()=>openCreate('brief')}>Use template <Icon name="arrow" size={13}/></button></div>)}</div><SectionTitle title="Recent briefs" eyebrow={`${data.briefs.length} RECORDS`}/><Panel><div className="simple-list">{data.briefs.map(b=><div key={b.id}><span className="list-icon"><Icon name="file"/></span><div><strong>{b.title}</strong><small>{b.id} · {b.type} · Updated {shortDate(b.updatedAt)}</small></div><Badge tone={b.status==='Approved'?'success':b.status==='Draft'?'neutral':'info'}>{b.status}</Badge><button className="icon-btn small" onClick={()=>removeRecord('briefs',b.id)} aria-label="Delete brief"><Icon name="close" size={14}/></button></div>)}</div></Panel></>;

  const renderBudget = () => <><SectionTitle title="Budget control" eyebrow="FINANCIAL VISIBILITY" action={<button className="btn btn-primary" onClick={()=>openCreate('expense')}><Icon name="plus" size={15}/> Add expense</button>}/><div className="metric-grid four"><MetricCard label="Planned" value={rupiah(budgetPlanned)} detail="Campaign budget plans" icon="wallet"/><MetricCard label="Committed" value={rupiah(budgetCommitted)} detail="Vendor / KOL commitments" icon="layers" tone="blue"/><MetricCard label="Actual" value={rupiah(budgetActual)} detail="Ledger + Ads spend" icon="chart" tone="amber"/><MetricCard label="Remaining" value={rupiah(budgetRemaining)} detail="Planned − committed − actual" icon="activity" tone="mint"/></div><div className="content-two-col"><Panel title="Workspace budget utilization"><div className="budget-hero"><div><strong>{budgetPlanned?Math.round((budgetActual+budgetCommitted)/budgetPlanned*100):0}%</strong><span>of planned budget used / committed</span></div><div className="budget-circle"><span>{budgetPlanned?Math.round((budgetActual+budgetCommitted)/budgetPlanned*100):0}%</span></div></div><Progress value={budgetPlanned?(budgetActual+budgetCommitted)/budgetPlanned*100:0}/><div className="budget-legend"><div><i className="dot-violet"/><span>Actual</span><b>{rupiah(budgetActual)}</b></div><div><i className="dot-blue"/><span>Committed</span><b>{rupiah(budgetCommitted)}</b></div><div><i className="dot-muted"/><span>Remaining</span><b>{rupiah(budgetRemaining)}</b></div></div></Panel><Panel title="Budget by campaign"><div className="budget-campaign-list">{data.campaigns.map(c=>{const actual=data.expenses.filter(e=>e.campaignId===c.id&&e.type==='actual').reduce((s,e)=>s+e.amount,0)+data.ads.filter(a=>a.campaignId===c.id).reduce((s,a)=>s+a.spend,0); const committed=data.expenses.filter(e=>e.campaignId===c.id&&e.type==='committed').reduce((s,e)=>s+e.amount,0);return <div key={c.id}><div><strong>{c.name}</strong><small>{rupiah(actual+committed)} / {rupiah(c.plannedBudget)}</small></div><Progress value={c.plannedBudget?(actual+committed)/c.plannedBudget*100:0}/></div>})}</div></Panel></div><SectionTitle title="Expense ledger" eyebrow={`${data.expenses.length} ENTRIES`} action={<button className="btn btn-secondary" onClick={()=>exportCSV(data.expenses,'nexus-expenses.csv')}><Icon name="download" size={14}/> Export CSV</button>}/><Panel><ExpenseTable expenses={data.expenses}/></Panel></>;

  const renderTasks = () => {
    const columns = ['Backlog','To Do','In Progress','Review','Blocked','Done'];
    return <><SectionTitle title="Task board" eyebrow={`${data.tasks.length} TASKS · ${overdueTasks.length} OVERDUE`} action={<button className="btn btn-primary" onClick={()=>openCreate('task')}><Icon name="plus" size={15}/> New task</button>}/><div className="task-summary"><span><b>{data.tasks.filter(t=>t.status==='In Progress').length}</b> In progress</span><span><b>{pendingApproval}</b> Approval pending</span><span><b>{overdueTasks.length}</b> Overdue</span><span><b>{data.tasks.filter(t=>t.status==='Done').length}</b> Done</span></div><div className="kanban-board">{columns.map(column=><div className="kanban-column" key={column}><div className="kanban-head"><strong>{column}</strong><span>{data.tasks.filter(t=>t.status===column).length}</span></div>{data.tasks.filter(t=>t.status===column).map(task=><div className="task-card" key={task.id}><div className="task-card-top"><Badge tone={task.priority==='Urgent'||task.priority==='High'?'warning':'neutral'}>{task.priority}</Badge><button className="icon-btn small" aria-label="Delete task" onClick={()=>removeRecord('tasks',task.id)}><Icon name="more" size={15}/></button></div><strong>{task.title}</strong><small>{task.id}</small><div className="task-card-meta"><span><Icon name="users" size={12}/>{task.owner || '—'} → {task.assignee}</span><span><Icon name="calendar" size={12}/>{shortDate(task.dueDate)}</span></div><select value={task.status} onChange={e=>updateTaskStatus(task.id,e.target.value)} aria-label={`Status ${task.title}`}>{columns.map(s=><option key={s}>{s}</option>)}</select></div>)}{!data.tasks.some(t=>t.status===column)&&<div className="kanban-empty">No tasks</div>}</div>)}</div></>;
  };

  const renderCalendar = () => {
    const [anchorYear, anchorMonth, anchorDay] = calendarAnchor.split('-').map(Number);
    const anchorUtc = new Date(Date.UTC(anchorYear, anchorMonth - 1, anchorDay));
    const monthStartKey = `${anchorYear}-${String(anchorMonth).padStart(2, '0')}-01`;
    const monthStartUtc = new Date(Date.UTC(anchorYear, anchorMonth - 1, 1));
    const monthOffset = (monthStartUtc.getUTCDay() + 6) % 7;
    const dateLabel = (key: string) => new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(`${key}T12:00:00+07:00`));
    const campaignFor = (id?: string) => data.campaigns.find(c => c.id === id);
    const entries = [
      ...data.campaigns.flatMap(c => [
        { id: `${c.id}-start`, title: `${c.name} · start`, date: c.startDate, type: 'Campaign', status: c.status, owner: c.owner, campaignId: c.id, channel: c.channels[0] || 'Unspecified' },
        { id: `${c.id}-end`, title: `${c.name} · end`, date: c.endDate, type: 'Campaign', status: c.status, owner: c.owner, campaignId: c.id, channel: c.channels[0] || 'Unspecified' }
      ]),
      ...data.contents.map(c => ({ id: c.id, title: c.title, date: c.publishDate, type: 'Content', status: c.status, owner: c.owner, campaignId: c.campaignId, channel: c.platform })),
      ...data.tasks.map(t => ({ id: t.id, title: t.title, date: t.dueDate, type: 'Task', status: t.status, owner: t.owner || t.assignee, campaignId: t.campaignId, channel: campaignFor(t.campaignId)?.channels[0] || 'Unspecified' })),
      ...data.kols.filter(k => Boolean(k.publishDate)).map(k => ({ id: k.id, title: `${k.name} · collaboration`, date: k.publishDate!, type: 'KOL', status: k.stage, owner: 'KOL Manager', campaignId: k.campaignId, channel: k.platform }))
    ].sort((a, b) => a.date.localeCompare(b.date));
    const filtered = entries.filter(item =>
      (calendarCampaignFilter === 'all' || item.campaignId === calendarCampaignFilter) &&
      (calendarTypeFilter === 'all' || item.type === calendarTypeFilter) &&
      (calendarOwnerFilter === 'all' || item.owner === calendarOwnerFilter) &&
      (calendarStatusFilter === 'all' || item.status === calendarStatusFilter) &&
      (calendarChannelFilter === 'all' || item.channel.toLowerCase() === calendarChannelFilter.toLowerCase())
    );
    const channels = [...new Set(entries.map(item => item.channel).filter(Boolean))].sort();
    const owners = [...new Set(entries.map(item => item.owner).filter(Boolean))].sort();
    const statuses = [...new Set(entries.map(item => item.status).filter(Boolean))].sort();
    const monthCells = Array.from({ length: 42 }, (_, index) => {
      const key = addJakartaDays(index - monthOffset, monthStartKey);
      return { key, day: Number(key.slice(-2)), currentMonth: key.slice(0, 7) === calendarAnchor.slice(0, 7), items: filtered.filter(item => item.date === key) };
    });
    const weekOffset = (anchorUtc.getUTCDay() + 6) % 7;
    const weekStart = addJakartaDays(-weekOffset, calendarAnchor);
    const weekDays = Array.from({ length: 7 }, (_, index) => {
      const key = addJakartaDays(index, weekStart);
      return { key, items: filtered.filter(item => item.date === key) };
    });
    const monthLabel = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(`${calendarAnchor}T12:00:00+07:00`));
    const weekLabel = `${shortDate(weekStart)} — ${shortDate(weekDays[6].key)}`;
    const moveCalendar = (direction: number) => {
      if (calendarView === 'Month') {
        const next = new Date(Date.UTC(anchorYear, anchorMonth - 1 + direction, 1));
        setCalendarAnchor(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`);
      } else {
        setCalendarAnchor(addJakartaDays(direction * 7, calendarAnchor));
      }
    };
    const eventNode = (item: typeof entries[number]) => <div className={`calendar-event event-${item.type.toLowerCase()}`} key={item.id} title={`${item.title} · ${item.status}`}>{item.title}</div>;
    return <>
      <SectionTitle title="Content calendar" eyebrow="PUBLISHING & DELIVERY" action={<button className="btn btn-primary" onClick={() => openCreate('content')}><Icon name="plus" size={15}/> Add content</button>}/>
      <div className="calendar-toolbar calendar-toolbar-stack">
        <div className="calendar-selects">
          <select className="period-select" value={calendarCampaignFilter} onChange={e => setCalendarCampaignFilter(e.target.value)}><option value="all">All campaigns</option>{data.campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className="period-select" value={calendarChannelFilter} onChange={e => setCalendarChannelFilter(e.target.value)}><option value="all">All channels</option>{channels.map(channel => <option key={channel} value={channel}>{channel}</option>)}</select>
          <select className="period-select" value={calendarOwnerFilter} onChange={e => setCalendarOwnerFilter(e.target.value)}><option value="all">All PIC</option>{owners.map(owner => <option key={owner} value={owner}>{owner}</option>)}</select>
          <select className="period-select" value={calendarStatusFilter} onChange={e => setCalendarStatusFilter(e.target.value)}><option value="all">All status</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</select>
          <select className="period-select" value={calendarTypeFilter} onChange={e => setCalendarTypeFilter(e.target.value)}><option value="all">All item types</option>{['Campaign', 'Content', 'Task', 'KOL'].map(type => <option key={type} value={type}>{type}</option>)}</select>
        </div>
        <div className="calendar-nav">
          <div className="view-switch">{(['Month', 'Week', 'List'] as const).map(view => <button className={calendarView === view ? 'selected' : ''} onClick={() => setCalendarView(view)} key={view}>{view}</button>)}</div>
          {calendarView !== 'List' && <div className="calendar-period-nav"><button className="icon-btn small" aria-label="Previous period" onClick={() => moveCalendar(-1)}>‹</button><strong>{calendarView === 'Month' ? monthLabel : weekLabel}</strong><button className="icon-btn small" aria-label="Next period" onClick={() => moveCalendar(1)}>›</button><button className="text-btn" onClick={() => setCalendarAnchor(jakartaDateKey())}>Today</button></div>}
          {calendarView === 'List' && <span className="calendar-period-label">All scheduled items</span>}
        </div>
      </div>
      <Panel>
        <div className={`calendar-grid calendar-${calendarView.toLowerCase()}`}>
          {calendarView === 'Month' && <>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div className="calendar-day-label" key={day}>{day}</div>)}{monthCells.map(cell => <div className={`calendar-cell ${cell.currentMonth ? '' : 'outside-month'}`} key={cell.key}><span className="calendar-date">{cell.day}</span>{cell.items.slice(0, 3).map(eventNode)}{cell.items.length > 3 && <small>+{cell.items.length - 3} more</small>}</div>)}</>}
          {calendarView === 'Week' && weekDays.map(day => <div className="calendar-cell" key={day.key}><span className="calendar-date">{dateLabel(day.key)}</span><div className="calendar-day-events">{day.items.map(eventNode)}{!day.items.length && <small className="calendar-no-events">No scheduled items</small>}</div></div>)}
          {calendarView === 'List' && filtered.map(item => <div className="calendar-cell" key={item.id}><span className="calendar-date">{shortDate(item.date)} · {item.type}</span><strong>{item.title}</strong><small>{item.owner} · {item.status} · {item.channel}</small></div>)}
        </div>
        {!filtered.length && <Empty title="No scheduled items" body="Ubah filter atau tambahkan content/task dengan deadline yang jelas."/>}
      </Panel>
      <div className="helper-row"><span><Icon name="info" size={14}/> Timeline campaign, publish date content, deadline task, dan tanggal publish KOL ditampilkan jika tersedia. Semua tanggal mengikuti Asia/Jakarta.</span></div>
    </>;
  };

  const renderContent = () => <><SectionTitle title="Content pipeline" eyebrow={`${data.contents.length} CONTENT RECORDS`} action={<button className="btn btn-primary" onClick={()=>openCreate('content')}><Icon name="plus" size={15}/> New content</button>}/><div className="filter-row"><div className="view-switch">{['All','Idea','Production','Review','Approved','Scheduled','Published'].map(v=><button key={v} className={contentFilter===v?'selected':''} onClick={()=>setContentFilter(v)}>{v}</button>)}</div><button className="btn btn-secondary" onClick={()=>exportCSV(data.contents,'nexus-content.csv')}><Icon name="download" size={14}/> Export</button></div><Panel><ContentTable content={data.contents.filter(c=>contentFilter==='All'||c.status===contentFilter)} onStatus={updateContentStatus} onDelete={id=>removeRecord('contents',id)}/></Panel></>;

  const renderAdsSales = () => <><SectionTitle title="Ads & sales" eyebrow="PERFORMANCE + TRANSACTIONS" action={<div className="action-group"><button className="btn btn-secondary" onClick={()=>importInput.current?.click()}><Icon name="upload" size={14}/> Import CSV</button><button className="btn btn-primary" onClick={()=>openCreate(adsTab==='sales'?'order':'experiment')}>{adsTab==='sales'?<><Icon name="plus" size={14}/> Add order</>:<><Icon name="plus" size={14}/> Log experiment</>}</button></div>}/><div className="tab-bar compact-tabs"><button className={adsTab==='ads'?'selected':''} onClick={()=>setAdsTab('ads')}>Meta Ads performance</button><button className={adsTab==='sales'?'selected':''} onClick={()=>setAdsTab('sales')}>Sales & orders</button></div>{adsTab==='ads'?<><div className="metric-grid four"><MetricCard label="Spend" value={rupiah(spend)} detail="Source: imported/demo" icon="wallet"/><MetricCard label="Impressions" value={compactNumber(data.ads.reduce((s,a)=>s+a.impressions,0))} detail="Ad delivery" icon="image" tone="blue"/><MetricCard label="Link clicks" value={compactNumber(data.ads.reduce((s,a)=>s+a.clicks,0))} detail="Link clicks" icon="arrow" tone="mint"/><MetricCard label="Purchases" value={String(data.ads.reduce((s,a)=>s+a.purchases,0))} detail="Platform attributed" icon="check-square" tone="amber"/></div><Panel title="Ads performance records"><AdTable ads={data.ads}/></Panel><Panel title="Experiment log" action={<button className="text-btn" onClick={()=>openCreate('experiment')}>Add experiment <Icon name="plus" size={12}/></button>}><div className="simple-list">{data.experiments.map(ex=><div key={ex.id}><span className="list-icon"><Icon name="activity"/></span><div><strong>{ex.name}</strong><small>{ex.id} · {ex.owner} · {ex.primaryMetric}</small><small>Hypothesis: {ex.hypothesis}</small><small>Success criteria: {ex.successCriteria}</small></div><Badge tone={ex.status==='Completed'?'success':ex.status==='Running'?'info':'neutral'}>{ex.status}</Badge></div>)}</div>{!data.experiments.length&&<Empty title="No experiments logged" body="Catat hipotesis, perubahan, owner, dan metrik validasi."/>}</Panel><div className="helper-row"><span>CPM, Link CTR, Link CPC, LPV, ATC, IC, CPA, dan ROAS dihitung hanya ketika denominator dan field sumber tersedia. Nilai kosong tetap N/A.</span></div></>:<><div className="metric-grid four"><MetricCard label="Paid orders" value={String(ordersCount)} detail="Order status paid" icon="check-square" tone="mint"/><MetricCard label="Gross paid revenue" value={rupiah(revenue)} detail="Actual order source" icon="wallet"/><MetricCard label="AOV" value={rupiah(ordersCount?revenue/ordersCount:undefined)} detail="Paid revenue / paid orders" icon="activity" tone="blue"/><MetricCard label="Refunded" value={String(data.orders.filter(o=>o.status==='Refunded').length)} detail="Separate from paid orders" icon="refresh" tone="amber"/></div><Panel title="Order ledger" action={<button className="btn btn-secondary" onClick={()=>exportCSV(data.orders,'nexus-orders.csv')}><Icon name="download" size={14}/> Export CSV</button>}><OrderTable orders={data.orders}/></Panel></>}</>;

  const renderKol = () => <><SectionTitle title="Creator relationship manager" eyebrow={`${data.kols.length} CREATORS`} action={<button className="btn btn-primary" onClick={()=>openCreate('kol')}><Icon name="plus" size={15}/> Add creator</button>}/><div className="summary-strip"><div><small>Prospects</small><strong>{data.kols.filter(k=>k.stage==='Prospect').length}</strong></div><div><small>Negotiation / deal</small><strong>{data.kols.filter(k=>['Negotiation','Deal'].includes(k.stage)).length}</strong></div><div><small>Briefed</small><strong>{data.kols.filter(k=>k.stage==='Briefed').length}</strong></div><div><small>Committed rate card</small><strong>{rupiah(data.kols.filter(k=>['Deal','Briefed','Draft Review','Approved'].includes(k.stage)).reduce((s,k)=>s+k.rate,0))}</strong></div></div><Panel title="Creator pipeline"><div className="pipeline-board">{['Prospect','Contacted','Negotiation','Deal','Briefed','Draft Review','Approved','Published','Paid','Evaluated'].map(stage=><div key={stage}><span>{stage}</span><b>{data.kols.filter(k=>k.stage===stage).length}</b></div>)}</div></Panel><Panel title="Creator database"><KolTable kols={data.kols} onDelete={id=>removeRecord('kols',id)}/></Panel></>;

  const renderAnalytics = () => <><SectionTitle title="Performance analytics" eyebrow="CROSS-CHANNEL VIEW" action={<select className="period-select" value={dateRange} onChange={e=>setDateRange(e.target.value)}><option value="7D">Last 7 days</option><option value="30D">Last 30 days</option><option value="90D">Last 90 days</option></select>}/><div className="metric-grid four"><MetricCard label="Actual sales revenue" value={rupiah(revenue)} detail="Order source · paid only" icon="wallet" tone="mint"/><MetricCard label="Ads attributed revenue" value={rupiah(attributedRevenue)} detail="Platform-reported attribution" icon="chart" tone="blue"/><MetricCard label="Paid media spend" value={rupiah(spend)} detail="Imported spend" icon="activity" tone="amber"/><MetricCard label="Blended ROAS" value={blendedRoas===undefined?'N/A':`${blendedRoas.toFixed(2)}x`} detail="Actual revenue / paid spend" icon="sparkles"/></div><div className="content-two-col"><Panel title="Revenue vs ad spend"><div className="chart-summary"><strong>{rupiah(revenue)}</strong><span>Actual paid revenue · local dataset</span></div><TrendChart/></Panel><Panel title="Channel coverage"><div className="coverage-list">{['Meta Ads','Instagram','TikTok','YouTube','Scalev','Lynk.id'].map((item,i)=><div key={item}><span>{item}</span><Badge tone={i===0?'warning':'neutral'}>{i===0?'CSV / demo':'Not connected'}</Badge></div>)}</div></Panel></div><Panel title="Content performance ranking"><div className="table-wrap"><table><thead><tr><th>Content</th><th>Platform</th><th>Format</th><th>Views</th><th>Engagement rate</th></tr></thead><tbody>{[...scopedContents].sort((a,b)=>(b.views||0)-(a.views||0)).map(c=><tr key={c.id}><td><strong>{c.title}</strong><small>{c.id}</small></td><td>{c.platform}</td><td>{c.format}</td><td>{c.views?compactNumber(c.views):'N/A'}</td><td>{c.engagement?`${c.engagement}%`:'N/A'}</td></tr>)}</tbody></table></div></Panel><div className="helper-row"><span>Engagement rate lintas platform tidak dapat dibandingkan tanpa denominator yang konsisten. Metrik kosong ditampilkan N/A.</span></div></>;

  const renderCompetitors = () => <><SectionTitle title="Competitor intelligence" eyebrow="PUBLIC SIGNAL MONITORING" action={<button className="btn btn-primary" onClick={()=>openCreate('competitor')}><Icon name="plus" size={15}/> Track account</button>}/><div className="notice notice-warning"><Icon name="shield"/><span>NEXUS hanya menyimpan metrik publik atau data yang diunggah secara sah. Reach, saves, impressions, dan conversion privat tidak diasumsikan tersedia.</span></div><div className="competitor-grid">{data.competitors.map(c=><div className="competitor-card" key={c.id}><div className="competitor-head"><span className="competitor-avatar">{c.platform==='Instagram'?'◎':'♪'}</span><Badge tone="success">{c.status}</Badge></div><h3>{c.name}</h3><p>{c.handle} · {c.platform}</p><div className="competitor-label">{c.label}</div><small>{c.notes}</small><div className="competitor-actions"><button className="text-btn" onClick={()=>{update('competitorPosts',curr=>[{id:`CMP-POST-${Date.now()}`,competitorId:c.id,title:'Manual observation',url:c.url,observedAt:jakartaDateKey(),format:'Unknown',hook:'Not recorded',angle:'Not recorded',note:'Add evidence from public URL or authorized upload.'},...curr]);notify('Observation note dibuat. Lengkapi bukti secara manual.')}}>Add observation</button><button className="icon-btn small" onClick={()=>removeRecord('competitors',c.id)} aria-label="Remove competitor"><Icon name="close" size={14}/></button></div></div>)}</div><Panel title="Observed public content"><div className="simple-list">{data.competitorPosts.map(post=><div key={post.id}><span className="list-icon"><Icon name="radar"/></span><div><strong>{post.title}</strong><small>{post.format} · {shortDate(post.observedAt)} · {post.hook}</small><small>Views {post.views?compactNumber(post.views):'N/A'} · Likes {post.likes??'N/A'} · Shares {post.shares??'N/A'}</small></div><Badge tone="info">Public / manual</Badge></div>)}</div>{!data.competitorPosts.length&&<Empty title="No observation yet" body="Tambahkan URL dan catat struktur konten yang terlihat."/>}</Panel></>;

  const buildInsights = () => {
    const overdue = data.tasks.filter(t=>t.status!=='Done'&&t.dueDate<jakartaDateKey());
    const missingOwner = data.campaigns.filter(c=>!c.owner);
    const noBudget = data.campaigns.filter(c=>!c.plannedBudget);
    const paid = data.orders.filter(o=>o.status==='Paid');
    const unassigned = paid.filter(o=>!o.campaignId);
    return [
      {kind:'Evidence',title:'Operational bottleneck',body:`Terdapat ${overdue.length} task belum selesai yang melewati due date.`,detail:overdue.map(t=>t.title).join(' · ')||'No overdue task in local dataset.',tone:'warning',action:'Prioritaskan rekonsiliasi dan approval yang tertunda.'},
      {kind:'Evidence',title:'Sales attribution coverage',body:`${unassigned.length} dari ${paid.length} paid orders belum terhubung ke Campaign ID.`,detail:'Order yang tidak memiliki UTM/campaign reference harus tetap unattributed.',tone:'info',action:'Perbaiki mapping UTM dan lakukan rekonsiliasi external order ID.'},
      {kind:'Hypothesis',title:'Paid media efficiency',body:spend>0?`Blended ROAS pada sample lokal sekitar ${(revenue/spend).toFixed(2)}x.`:'Spend belum tersedia pada dataset.',detail:'Angka ini tidak membuktikan kausalitas atau profitabilitas dan menggabungkan periode/source yang mungkin berbeda.',tone:'violet',action:'Validasi periode, attribution window, net revenue, dan biaya non-media sebelum mengambil keputusan.'},
      {kind:'Data gap',title:'Connector coverage',body:'Scalev, Lynk.id, Instagram, TikTok, dan YouTube belum memiliki koneksi resmi.',detail:'Dashboard hanya menggunakan data demo/manual saat ini.',tone:'neutral',action:'Hubungkan API resmi atau impor CSV sebelum evaluasi lintas channel.'},
      {kind:'Data gap',title:'Campaign completeness',body:`${missingOwner.length} campaign belum memiliki owner dan ${noBudget.length} belum memiliki budget plan.`,detail:'Campaign aktif wajib memiliki owner, objective, period, KPI, brief, dan budget.',tone:'warning',action:'Lengkapi field wajib pada Campaign Workspace.'}
    ];
  };
  const renderAI = () => <><SectionTitle title="NEXUS Insight Lab" eyebrow="HISTORICAL INTELLIGENCE" action={<Badge tone="warning">RULE-BASED · NOT AI CONNECTED</Badge>}/><div className="notice notice-info"><Icon name="sparkles"/><span>Analisis di bawah dibuat dari aturan lokal dan dataset demo. Ini bukan respons model AI, belum menggunakan retrieval historis produksi, dan tidak boleh diperlakukan sebagai kesimpulan kausal.</span></div><div className="insight-grid">{buildInsights().map((item,i)=><div className={`insight-card insight-${item.tone}`} key={item.title}><div className="insight-head"><Badge tone={item.kind==='Evidence'?'success':item.kind==='Hypothesis'?'warning':'neutral'}>{item.kind}</Badge><span>0{i+1}</span></div><h3>{item.title}</h3><strong>{item.body}</strong><p>{item.detail}</p><div className="insight-action"><small>Suggested next step</small><span>{item.action}</span></div><button className="text-btn" onClick={()=>openCreate('action')}>Turn into action <Icon name="arrow" size={13}/></button></div>)}</div><Panel title="Evaluation note" className="evaluation-note"><div className="evaluation-grid"><div><small>Observation</small><p>Data lokal berisi campuran seed dan input manual.</p></div><div><small>Evidence</small><p>Masing-masing record menyimpan source/period jika tersedia; histori konektor masih belum aktif.</p></div><div><small>Hypothesis</small><p>Ketidakteraturan workflow dapat menunda keputusan, tetapi perlu diuji dengan activity log.</p></div><div><small>Decision</small><p>Validasi kualitas data dan selesaikan task prioritas sebelum optimasi.</p></div></div><button className="btn btn-secondary" onClick={()=>openCreate('action')}><Icon name="plus" size={14}/> Create action item</button></Panel></>;

  const renderReports = () => <><SectionTitle title="Reports & exports" eyebrow="DECISION RECORDS" action={<div className="action-group"><button className="btn btn-secondary" onClick={()=>exportJSON()}><Icon name="download" size={14}/> Backup JSON</button><button className="btn btn-primary" onClick={()=>window.print()}><Icon name="file-chart" size={14}/> Print / Save PDF</button></div>}/><div className="notice notice-warning"><Icon name="clock"/><span>Automated PDF pukul 00:00 WIB membutuhkan scheduler backend dan Gmail API. Versi ini menyediakan preview/print manual; tidak mengirim email otomatis.</span></div><div className="report-preview"><div className="report-brand"><div className="brand-mark">N</div><div><strong>NEXUS DAILY SNAPSHOT</strong><small>{new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'})} · Asia/Jakarta</small></div><Badge tone="warning">LOCAL PREVIEW</Badge></div><div className="report-executive"><span className="eyebrow">EXECUTIVE SUMMARY</span><h2>{totalRevenueText} recorded paid revenue</h2><p>{ordersCount} paid orders · {rupiah(spend)} imported ad spend · {blendedRoas===undefined?'ROAS N/A':`${blendedRoas.toFixed(2)}x blended ROAS`}</p></div><div className="report-kpis"><div><small>Sales</small><b>{rupiah(revenue)}</b></div><div><small>Orders</small><b>{ordersCount}</b></div><div><small>Ad spend</small><b>{rupiah(spend)}</b></div><div><small>Budget plan</small><b>{rupiah(budgetPlanned)}</b></div></div><div className="report-columns"><div><h3>Operational attention</h3><p>{overdueTasks.length} overdue task · {pendingApproval} pending review</p><h3>Data availability</h3><p>Meta Ads: imported/demo. Scalev, Lynk.id, social APIs: unavailable.</p></div><div><h3>Data integrity</h3><p>Last local update: {new Date(data.updatedAt).toLocaleString('id-ID')}</p><p>Report period and source finality are not validated by a backend scheduler.</p></div></div></div><Panel title="Report delivery history"><Empty title="No automated deliveries" body="Delivery log akan terisi setelah backend scheduler, Gmail OAuth, dan session-recipient rules diimplementasikan."/></Panel></>;

  const integrationCards = [
    {name:'Meta Ads',group:'Paid media',detail:'Ads Insights · spend, impressions, reach, clicks, purchases',status:'planned' as const,frequency:'Target 10–15 min',priority:'P1'},
    {name:'Scalev',group:'Sales & funnel',detail:'Visits, checkout, order, revenue, refund status',status:'planned' as const,frequency:'Target 10–15 min',priority:'P1'},
    {name:'Lynk.id',group:'Sales & funnel',detail:'Checkout, payment, order, revenue, reconciliation',status:'planned' as const,frequency:'Target 10–15 min',priority:'P1'},
    {name:'Instagram',group:'Social analytics',detail:'Account and content metrics via official OAuth/API',status:'unavailable' as const,frequency:'Cadence TBD',priority:'P1'},
    {name:'TikTok',group:'Social analytics',detail:'Account and content metrics within approved scopes',status:'unavailable' as const,frequency:'Cadence TBD',priority:'P1'},
    {name:'YouTube',group:'Social analytics',detail:'Channel and video analytics via channel-owner OAuth',status:'unavailable' as const,frequency:'Cadence TBD',priority:'P1'},
    {name:'Gmail',group:'Reporting & security',detail:'Daily PDF delivery and security alerts',status:'planned' as const,frequency:'Daily report · 00:00 WIB',priority:'P1'},
    {name:'Google Drive',group:'Backup & restore',detail:'Encrypted one-way backup and integrity checks',status:'planned' as const,frequency:'Schedule TBD',priority:'P1'}
  ];
  const renderIntegrations = () => <><SectionTitle title="Connected sources" eyebrow="CONNECTOR CONTROL PLANE" action={<button className="btn btn-secondary" onClick={()=>notify('Koneksi API belum diaktifkan. Lengkapi konfigurasi server dan OAuth credentials.') }><Icon name="refresh" size={14}/> Refresh status</button>}/><div className="notice notice-info"><Icon name="plug"/><span>Credential tidak boleh disimpan di browser/localStorage. Konektor produksi harus berjalan melalui backend adapter dengan token terenkripsi, rate-limit, retry, dan audit log.</span></div><div className="integration-grid">{integrationCards.map(item=><div className="integration-card" key={item.name}><div className="integration-card-top"><div className={`integration-logo logo-${item.name.toLowerCase().replace(/[^a-z]/g,'')}`}>{item.name.slice(0,1)}</div><StatusDot status={item.status}/></div><span className="eyebrow">{item.group}</span><h3>{item.name}</h3><p>{item.detail}</p><div className="integration-meta"><span>{item.frequency}</span><Badge>{item.priority}</Badge></div><button className="btn btn-secondary btn-block" onClick={()=>notify(`${item.name}: connector belum dikonfigurasi pada build lokal.`)}>Configure connector <Icon name="arrow" size={13}/></button></div>)}</div></>;

  const renderSettings = () => <><SectionTitle title="Workspace settings" eyebrow="PREFERENCES & DATA CONTROL"/><div className="content-two-col"><Panel title="Workspace profile"><div className="settings-form"><label className="field"><span>Workspace name</span><input defaultValue={workspace.name}/></label><div className="form-grid"><label className="field"><span>Timezone</span><input value="Asia/Jakarta (WIB)" readOnly/></label><label className="field"><span>Currency</span><input value="IDR" readOnly/></label></div><label className="field"><span>Workspace description</span><textarea defaultValue="Marketing Intelligence & Operations workspace" rows={3}/></label><button className="btn btn-primary" onClick={()=>notify('Preferensi tampilan disimpan lokal; profile server belum tersedia.')}>Save preferences</button></div></Panel><Panel title="Local data backup"><div className="settings-action"><div><strong>Export local workspace</strong><small>JSON berisi seluruh records yang tersimpan pada browser ini.</small></div><button className="btn btn-secondary" onClick={exportJSON}><Icon name="download" size={14}/> Export</button></div><div className="settings-action"><div><strong>Restore workspace backup</strong><small>Mengganti seluruh data lokal dengan file backup pilihan.</small></div><button className="btn btn-secondary" onClick={startRestore}><Icon name="upload" size={14}/> Restore</button></div><div className="settings-action"><div><strong>Export orders CSV</strong><small>Data transaksi aktual dan status.</small></div><button className="btn btn-secondary" onClick={()=>exportCSV(data.orders,'nexus-orders.csv')}>Export CSV</button></div><input ref={restoreInput} className="visually-hidden" type="file" accept="application/json" onChange={e=>handleRestoreFile(e.target.files?.[0])}/></Panel></div><Panel title="Data dictionary"><div className="table-wrap"><table><thead><tr><th>Metric</th><th>Operational definition</th><th>Availability</th></tr></thead><tbody>{[['Spend','Biaya iklan yang dilaporkan platform','Source-dependent'],['CPM','Spend / impressions × 1.000','Calculated if available'],['Link CTR','Link clicks / impressions × 100%','Calculated if available'],['Link CPC','Spend / link clicks','Calculated if available'],['CPA','Spend / purchases sesuai atribusi','Attribution-dependent'],['ROAS','Attributed revenue / ad spend','Attribution-dependent'],['Blended ROAS','Total business revenue / paid ad spend','Period alignment required'],['AOV','Revenue / order count','Gross/net definition required'],['Engagement rate','Engagement / defined denominator','Platform-specific']].map(row=><tr key={row[0]}><td><strong>{row[0]}</strong></td><td>{row[1]}</td><td>{row[2]}</td></tr>)}</tbody></table></div></Panel><Panel title="Prototype data controls"><div className="settings-action"><div><strong>Reset to demo seed</strong><small>Mengembalikan browser ke sample dataset awal.</small></div><button className="btn btn-danger" onClick={()=>{if(window.confirm('Reset seluruh data lokal ke demo seed?')){setData(demoData);notify('Demo data di-reset.')}}}>Reset demo data</button></div><div className="helper-row"><span>Storage key: {workspaceStorageKey} · Local browser only · Last update {new Date(data.updatedAt).toLocaleString('id-ID')}</span></div></Panel></>;

  const renderAccess = () => <AccessManagement workspaceId={workspace.id}/>;

  const renderPage = () => {
    switch(page) {
      case 'overview': return renderOverview();
      case 'briefs': return renderBriefs();
      case 'campaigns': return renderCampaigns();
      case 'campaign-detail': return renderCampaignDetail();
      case 'budget': return renderBudget();
      case 'tasks': return renderTasks();
      case 'calendar': return renderCalendar();
      case 'content': return renderContent();
      case 'ads-sales': return renderAdsSales();
      case 'kol': return renderKol();
      case 'analytics': return renderAnalytics();
      case 'competitors': return renderCompetitors();
      case 'ai-lab': return renderAI();
      case 'reports': return renderReports();
      case 'integrations': return renderIntegrations();
      case 'settings': return renderSettings();
      case 'access': return isOwner ? renderAccess() : <Empty title="Owner access required" body="Halaman ini hanya tersedia untuk Owner."/>;
      default: return renderOverview();
    }
  };

  return <div className="app-shell">
    <aside className="sidebar desktop-sidebar">{renderSidebar()}</aside>
    {drawerOpen&&<><button className="drawer-scrim" aria-label="Close navigation" onClick={()=>setDrawerOpen(false)}/><aside className="sidebar mobile-sidebar">{renderSidebar(true)}</aside></>}
    <main className="main-shell">{renderHeader()}<div className="demo-banner"><span className="demo-dot"/><strong>AUTHENTICATED SESSION</strong><span>Records remain browser-local · provider integrations inactive</span><span className="connection-label">{online?'ONLINE':'OFFLINE'}</span></div><div className="page-content"><div className="page-heading">{page!=='overview'&&<><div className="page-heading-copy"><span className="eyebrow">{pageMeta.phase}</span><h1>{pageMeta.title}</h1><p>{pageMeta.subtitle}</p></div>{page==='campaign-detail'&&null}</>}</div>{renderPage()}<footer className="app-footer"><span>NEXUS v0.3 · Nocturne interface</span><span>Updated locally · {new Date(data.updatedAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})} WIB</span></footer></div></main>
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{[{id:'overview' as PageId,label:'Home',icon:'grid'},{id:'campaigns' as PageId,label:'Plan',icon:'layers'},{id:'tasks' as PageId,label:'Tasks',icon:'check-square'},{id:'analytics' as PageId,label:'Insights',icon:'activity'}].map(item=><button key={item.id} className={page===item.id?'active':''} onClick={()=>navigate(item.id)}><Icon name={item.icon} size={18}/><span>{item.label}</span></button>)}</nav>
    <button className="ai-launcher" onClick={()=>setAiOpen(true)} aria-label="Open NEXUS AI assistant"><span><Icon name="sparkles" size={19}/></span><b>Ask NEXUS</b></button>
    {aiOpen&&<><button className="ai-scrim" aria-label="Close assistant" onClick={()=>setAiOpen(false)}/><aside className="ai-panel glass"><div className="ai-panel-head"><div className="ai-title"><span className="ai-orb"><Icon name="sparkles" size={19}/></span><div><strong>NEXUS Assistant</strong><small>{pageMeta.phase} · {activePage}</small></div></div><button className="icon-btn" onClick={()=>setAiOpen(false)} aria-label="Close assistant"><Icon name="close"/></button></div><div className="ai-context"><span className="eyebrow">CURRENT PAGE FOCUS</span><strong>{page==='overview'?'Revenue quality & operational priority':page==='campaigns'?'Campaign completeness & ownership':page==='tasks'?'Task bottlenecks & deadlines':page==='content'?'Hook, format & content pipeline':page==='budget'?'Budget pacing & commitment':'Data availability & decision quality'}</strong><p>Context: {activePage} · Period {dateRange} · {data.campaigns.length} campaign records</p></div><div className="ai-review-card"><Badge tone="warning">RULE-BASED DEMO</Badge><h3>{overdueTasks.length?`${overdueTasks.length} overdue tasks need attention`:'No critical task delay detected'}</h3><p>{overdueTasks.length?'Tinjau overdue task dan approval sebelum menambah beban campaign.':'Lanjutkan monitoring data freshness dan kelengkapan source.'}</p><div className="ai-evidence"><small>Evidence</small><span>{overdueTasks.map(t=>t.title).join(' · ')||'No overdue record in current local data.'}</span></div></div><div className="ai-review-card secondary"><h3>Ask about this page</h3><p>Assistant produksi akan menggunakan retrieval ke database NEXUS dan menyertakan source reference. Mode ini belum terhubung ke model AI.</p><div className="ai-suggestions"><button onClick={()=>{navigate('ai-lab');setAiOpen(false)}}>Evaluate data gaps <Icon name="arrow" size={12}/></button><button onClick={()=>{navigate('tasks');setAiOpen(false)}}>Review overdue tasks <Icon name="arrow" size={12}/></button></div></div><div className="ai-input-row"><input placeholder="AI provider belum dikonfigurasi" disabled/><button disabled aria-label="Send message"><Icon name="arrow"/></button></div><small className="ai-disclaimer">AI hanya memberi rekomendasi. Aksi operasional tetap memerlukan persetujuan pengguna.</small></aside></>}
    {modal&&<CreateModal kind={modal} campaigns={data.campaigns} onClose={()=>setModal(null)} onSave={createRecord}/>}
    <input ref={importInput} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={e=>handleCsvFile(e.target.files?.[0])}/>
    {importPreview&&<div className="modal-backdrop"><div className="modal glass import-modal"><div className="modal-head"><div><span className="eyebrow">CSV IMPORT PREVIEW</span><h2>Review mapping · {importPreview.filename}</h2><p>{importPreview.type==='orders'?'Detected: Sales / Orders':'Detected: Ads performance'} · Preview first 8 rows</p></div><button className="icon-btn" onClick={()=>setImportPreview(null)} aria-label="Close"><Icon name="close"/></button></div><div className="table-wrap"><table><thead><tr>{importPreview.headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{importPreview.rows.map((row,i)=><tr key={i}>{importPreview!.headers.map((_,j)=><td key={j}>{row[j]||'—'}</td>)}</tr>)}</tbody></table></div><p className="panel-footnote">Import menggunakan pencocokan nama kolom dasar. Periksa mapping di CSV dan duplikasi sebelum melanjutkan.</p><div className="modal-actions"><button className="btn btn-ghost" onClick={()=>setImportPreview(null)}>Cancel</button><button className="btn btn-primary" onClick={confirmCSVImport}>Import records</button></div></div></div>}
    {toast&&<div className="toast"><span><Icon name="check" size={15}/></span>{toast}</div>}
  </div>;
}

function TaskList({ tasks, onChange }: { tasks: Task[]; onChange: (id:string,status:string)=>void }) {
  return <div className="simple-list">{tasks.map(task=><div key={task.id}><span className="list-icon"><Icon name="check-square"/></span><div><strong>{task.title}</strong><small>{task.id} · Owner: {task.owner || 'Unassigned'} · PIC: {task.assignee} · Due {shortDate(task.dueDate)}</small></div><select value={task.status} onChange={e=>onChange(task.id,e.target.value)}>{['Backlog','To Do','In Progress','Review','Blocked','Done'].map(s=><option key={s}>{s}</option>)}</select></div>)}</div>;
}
function ContentTable({ content, onStatus, onDelete }: { content: ContentItem[]; onStatus: (id:string,status:string)=>void; onDelete?: (id:string)=>void }) {
  return <div className="table-wrap"><table><thead><tr><th>Content</th><th>Platform / format</th><th>Owner</th><th>Publish date</th><th>Status</th><th>Views</th><th/></tr></thead><tbody>{content.map(c=><tr key={c.id}><td><strong>{c.title}</strong><small>{c.id} · {c.pillar}</small></td><td>{c.platform}<small>{c.format}</small></td><td>{c.owner}</td><td>{shortDate(c.publishDate)}</td><td><select className="inline-select" value={c.status} onChange={e=>onStatus(c.id,e.target.value)}>{['Idea','Brief','Production','Review','Changes Requested','Approved','Scheduled','Published','Evaluated'].map(s=><option key={s}>{s}</option>)}</select></td><td>{c.views?compactNumber(c.views):'N/A'}</td><td>{onDelete&&<button className="icon-btn small" onClick={()=>onDelete(c.id)} aria-label="Delete content"><Icon name="close" size={14}/></button>}</td></tr>)}</tbody></table>{!content.length&&<Empty title="No content records" body="Buat content record atau ubah filter."/>}</div>;
}
function ExpenseTable({ expenses }: { expenses: Expense[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Expense</th><th>Category / vendor</th><th>Date</th><th>Channel</th><th>Type</th><th>Amount</th></tr></thead><tbody>{expenses.map(e=><tr key={e.id}><td><strong>{e.title}</strong><small>{e.id}</small></td><td>{e.category}<small>{e.vendor}</small></td><td>{shortDate(e.date)}</td><td>{e.channel}</td><td><Badge tone={e.type==='actual'?'success':'info'}>{e.type}</Badge></td><td>{rupiah(e.amount)}</td></tr>)}</tbody></table>{!expenses.length&&<Empty title="No expenses" body="Belum ada expense yang dicatat."/>}</div>;
}
function KolTable({ kols, onDelete }: { kols: Kol[]; onDelete?: (id:string)=>void }) {
  return <div className="table-wrap"><table><thead><tr><th>Creator</th><th>Platform</th><th>Niche</th><th>Contact</th><th>Rate card</th><th>Pipeline</th><th>Publish date</th><th>Instagram</th><th/></tr></thead><tbody>{kols.map(k=><tr key={k.id}><td><strong>{k.name}</strong><small>{k.id} · {k.handle}</small></td><td>{k.platform}</td><td>{k.niche}</td><td>{k.contact}</td><td>{rupiah(k.rate)}</td><td><Badge tone={['Deal','Briefed','Published','Paid'].includes(k.stage)?'success':'info'}>{k.stage}</Badge></td><td>{shortDate(k.publishDate)}</td><td>{k.instagramUrl?<a className="table-link" href={k.instagramUrl} target="_blank" rel="noreferrer">Profile <Icon name="external" size={12}/></a>:'N/A'}</td><td>{onDelete&&<button className="icon-btn small" onClick={()=>onDelete(k.id)} aria-label="Delete creator"><Icon name="close" size={14}/></button>}</td></tr>)}</tbody></table>{!kols.length&&<Empty title="No creators found" body="Add creator untuk memulai pipeline."/>}</div>;
}
function AdTable({ ads }: { ads: AdMetric[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Campaign / date</th><th>Spend</th><th>Impressions</th><th>Reach</th><th>Link clicks</th><th>CPM</th><th>Link CTR</th><th>Purchases</th><th>CPA</th><th>ROAS</th></tr></thead><tbody>{ads.map(a=>{const cpm=a.impressions?a.spend/a.impressions*1000:undefined; const ctr=a.impressions?a.clicks/a.impressions*100:undefined; const cpa=a.purchases?a.spend/a.purchases:undefined; const roas=a.spend&&a.attributedRevenue!==undefined?a.attributedRevenue/a.spend:undefined; return <tr key={a.id}><td><strong>{a.campaignName}</strong><small>{a.id} · {shortDate(a.date)} · {a.source}</small></td><td>{rupiah(a.spend)}</td><td>{compactNumber(a.impressions)}</td><td>{a.reach?compactNumber(a.reach):'N/A'}</td><td>{compactNumber(a.clicks)}</td><td>{cpm===undefined?'N/A':rupiah(cpm)}</td><td>{ctr===undefined?'N/A':`${ctr.toFixed(2)}%`}</td><td>{a.purchases}</td><td>{cpa===undefined?'N/A':rupiah(cpa)}</td><td>{roas===undefined?'N/A':`${roas.toFixed(2)}x`}</td></tr>})}</tbody></table>{!ads.length&&<Empty title="No Ads records" body="Import CSV untuk menambahkan metrik Ads."/>}</div>;
}
function OrderTable({ orders }: { orders: Order[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Order ID</th><th>Source</th><th>Date</th><th>Status</th><th>UTM / source</th><th>Amount</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td><strong>{o.id}</strong></td><td>{o.source}</td><td>{shortDate(o.date)}</td><td><Badge tone={o.status==='Paid'?'success':o.status==='Refunded'?'warning':'neutral'}>{o.status}</Badge></td><td>{o.utm||'Unattributed'}</td><td>{rupiah(o.amount)}</td></tr>)}</tbody></table>{!orders.length&&<Empty title="No orders" body="Tambahkan transaksi manual atau import CSV."/>}</div>;
}

function csvEscape(value: any) {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
}
function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i=0;i<text.length;i++) {
    const char=text[i];
    if (char==='"' && quoted && text[i+1]==='"') { cell+='"'; i++; }
    else if (char==='"') quoted=!quoted;
    else if (char===',' && !quoted) { row.push(cell); cell=''; }
    else if ((char==='\n'||char==='\r') && !quoted) { if (char==='\r'&&text[i+1]==='\n') i++; row.push(cell); rows.push(row); row=[]; cell=''; }
    else cell+=char;
  }
  if (cell.length||row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function parseIsoDateKey(value: string): string | undefined {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return undefined;
  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1] ? undefined : match[1];
}
function parseCsvNumber(value: string): number | undefined {
  const raw = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
  if (!raw) return undefined;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  const dotCount = (raw.match(/\./g) ?? []).length;
  const normalized = comma > dot
    ? raw.replace(/\./g, '').replace(',', '.')
    : dotCount > 1
      ? raw.replace(/\./g, '').replace(/,/g, '')
      : raw.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}


export default App;
