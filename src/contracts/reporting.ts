export type ReportSectionStatus = 'complete' | 'incomplete' | 'unavailable' | 'not_applicable';
export type DailyReportSection = {
  key: string;
  title: string;
  status: ReportSectionStatus;
  sourceNames: string[];
  lastSuccessfulSyncAt?: string;
  content: unknown;
  gapReason?: string;
};

export type DailyReport = {
  reportId: string;
  workspaceId: string;
  periodStart: string; // Inclusive, Asia/Jakarta.
  periodEnd: string;   // Exclusive, Asia/Jakarta next-day boundary.
  generatedAt: string;
  timezone: 'Asia/Jakarta';
  sections: DailyReportSection[];
  aiStatus: 'complete' | 'unavailable' | 'failed';
  deliveryStatus: 'pending' | 'sent' | 'skipped_no_active_session' | 'failed';
  recipientSnapshot: string[];
};

/** Scheduler, PDF rendering and Gmail delivery must run server-side. */
export type DailyReportSchedule = {
  localTime: '00:00';
  timezone: 'Asia/Jakarta';
  cronUtc: '0 17 * * *';
  period: 'previous_calendar_day';
  recipientRule: 'valid_non_expired_non_revoked_sessions_at_send_time';
  deduplicationKey: 'workspace_id + period_start + period_end';
};
