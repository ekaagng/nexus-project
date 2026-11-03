export type EvidenceReference = {
  entityType: 'campaign' | 'content' | 'task' | 'ad_metric' | 'order' | 'budget' | 'kol' | 'competitor_post';
  entityId: string;
  sourceLabel: string;
  periodStart?: string;
  periodEnd?: string;
  metricName?: string;
  metricValue?: number | string;
};

export type PageAnalysisRequest = {
  workspaceId: string;
  pageId: string;
  phase: 'overview' | 'plan' | 'execute' | 'optimize' | 'workspace';
  filters: { dateRange?: string; campaignId?: string; channel?: string };
  focusEntityIds: string[];
  question?: string;
};

export type PageAnalysis = {
  id: string;
  generatedAt: string;
  evidence: { statement: string; references: EvidenceReference[] }[];
  interpretations: string[];
  hypotheses: { statement: string; confidence: 'low' | 'medium' | 'high'; validationNeeded: string }[];
  recommendations: { action: string; reason: string; ownerSuggestion?: string; dueDateSuggestion?: string; successMetric: string }[];
  dataGaps: string[];
  disclaimer: string;
};

/** AI service must return evidence references and uncertainty labels; no operational writes. */
export interface IntelligenceService {
  evaluatePage(request: PageAnalysisRequest): Promise<PageAnalysis>;
  recordFeedback(analysisId: string, useful: boolean, note?: string): Promise<void>;
}
