import type { MetricData } from "../types/reporting.js";

/** v5 selector condition, still the shape tool params use. */
export interface ToolCondition {
  field: string;
  operator: string;
  values: string[];
}

export interface V1Filter {
  field: string;
  operator: string;
  value?: unknown;
}

export interface V1Query {
  filters?: V1Filter[];
  sorting?: Array<{ field: string; order: "ASC" | "DESC" }>;
  pagination?: { offset: number; pageSize: number; fetchTotalCount?: boolean };
}

const OPERATOR_ALIASES: Record<string, string> = {
  STARTSWITH: "STARTS_WITH",
  CONTAINS: "CONTAINS_ANY",
};

const SORT_FIELD_ALIASES: Record<string, string> = {
  avgCPA: "totalAvgCPI",
  avgCPT: "cpt",
  conversionRate: "totalInstallRate",
};

export function mapKeywordStatus(status: string): string {
  return status === "ACTIVE" ? "ENABLED" : status;
}

function mapFilterValue(field: string, operator: string, values: string[]): unknown {
  const mapped = values.map((value) => (field === "status" ? mapKeywordStatus(value) : value));
  if (operator === "EQUALS" && mapped.length === 1) {
    const only = mapped[0]!;
    return /^-?\d+$/.test(only) && field.toLowerCase().endsWith("id") ? Number(only) : only;
  }
  return mapped;
}

export function toolConditionsToFilters(conditions: ToolCondition[] | undefined): V1Filter[] {
  if (!conditions?.length) return [];
  return conditions.map((condition) => {
    const operator = OPERATOR_ALIASES[condition.operator] ?? condition.operator;
    return {
      field: condition.field,
      operator,
      value: mapFilterValue(condition.field, operator, condition.values),
    };
  });
}

export function equalsFilter(field: string, value: string | number): V1Filter {
  return { field, operator: "EQUALS", value };
}

export function inFilter(field: string, values: Array<string | number>): V1Filter {
  return { field, operator: "IN", value: values };
}

export function buildV1Query(opts: {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: "ASCENDING" | "DESCENDING" | "ASC" | "DESC";
  conditions?: ToolCondition[];
  filters?: V1Filter[];
} = {}): V1Query {
  const query: V1Query = {};
  const filters = [...(opts.filters ?? []), ...toolConditionsToFilters(opts.conditions)];
  if (filters.length) query.filters = filters;
  if (opts.sortBy) {
    const order = opts.sortOrder === "ASCENDING" || opts.sortOrder === "ASC" ? "ASC" : "DESC";
    query.sorting = [{ field: SORT_FIELD_ALIASES[opts.sortBy] ?? opts.sortBy, order }];
  }
  query.pagination = {
    offset: opts.offset ?? 0,
    pageSize: opts.limit ?? 50,
    fetchTotalCount: true,
  };
  return query;
}

export function buildV1Report(opts: {
  startDate: string;
  endDate: string;
  granularity?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: "ASCENDING" | "DESCENDING";
  filters?: V1Filter[];
  groupBy?: string[];
  includeGrandTotal?: boolean;
  timeZone?: string;
}): Record<string, unknown> {
  const query = buildV1Query({
    limit: opts.limit ?? 1000,
    offset: opts.offset,
    sortBy: opts.sortBy,
    sortOrder: opts.sortOrder,
    filters: opts.filters?.map((filter) =>
      filter.operator === "EQUALS" && !Array.isArray(filter.value)
        ? { ...filter, value: [filter.value] }
        : filter
    ),
  });
  const body: Record<string, unknown> = {
    ...query,
    timeRange: {
      start: opts.startDate,
      end: opts.endDate,
      timeZone: opts.timeZone ?? "ORTZ",
      ...(opts.granularity ? { granularity: opts.granularity } : {}),
    },
  };
  if (opts.groupBy?.length) body.groupBy = opts.groupBy;
  if (opts.includeGrandTotal) body.options = { includeRows: ["GRAND_TOTAL"] };
  return body;
}

export function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.acls)) return obj.acls as T[];
    if (Array.isArray(obj.rows)) return obj.rows as T[];
  }
  return [];
}

function moneyOf(value: unknown): { amount: string; currency: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const money = value as { amount?: unknown; currency?: unknown; value?: unknown };
  if (money.amount != null && money.currency != null) {
    return { amount: String(money.amount), currency: String(money.currency) };
  }
  if (money.value) return moneyOf(money.value);
  return undefined;
}

function aliasMetrics(raw: unknown): MetricData {
  const metrics = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const aliased = {
    ...metrics,
    avgCPA: moneyOf(metrics.avgCPA) ?? moneyOf(metrics.totalAvgCPI) ?? moneyOf(metrics.tapInstallCPI),
    avgCPT: moneyOf(metrics.avgCPT) ?? moneyOf(metrics.cpt),
    localSpend: moneyOf(metrics.localSpend),
    conversionRate: metrics.conversionRate ?? metrics.totalInstallRate ?? metrics.tapInstallRate ?? 0,
    impressions: metrics.impressions ?? 0,
    taps: metrics.taps ?? 0,
    totalInstalls: metrics.totalInstalls ?? 0,
    totalNewDownloads: metrics.totalNewDownloads ?? 0,
    totalRedownloads: metrics.totalRedownloads ?? 0,
  };
  return aliased as unknown as MetricData;
}

function aliasMetadata<M>(raw: unknown): M {
  const meta = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const keywordObj = meta.keyword && typeof meta.keyword === "object"
    ? meta.keyword as Record<string, unknown>
    : undefined;
  const adGroup = meta.adGroup && typeof meta.adGroup === "object"
    ? meta.adGroup as Record<string, unknown>
    : undefined;
  return {
    ...meta,
    keyword: typeof meta.keyword === "string" ? meta.keyword : keywordObj?.text ?? meta.text,
    keywordId: meta.keywordId ?? keywordObj?.id ?? meta.id,
    matchType: meta.matchType ?? keywordObj?.matchType,
    bidAmount: meta.bidAmount ?? meta.bid ?? keywordObj?.bid,
    campaignName: meta.campaignName ?? meta.name,
    campaignId: meta.campaignId ?? meta.id,
    adGroupName: meta.adGroupName ?? adGroup?.name,
    adGroupId: meta.adGroupId,
    searchTermSource: meta.searchTermSource ?? "n/a",
  } as M;
}

export interface NormalizedReportRow<M = Record<string, unknown>> {
  metadata: M;
  total: MetricData;
  granularity?: Array<{ date: string } & MetricData>;
}

export function normalizeReportRows<M = Record<string, unknown>>(data: unknown): NormalizedReportRow<M>[] {
  const rows = asList<Record<string, unknown>>(
    data && typeof data === "object" && "rows" in (data as object) ? data : { rows: data }
  );
  return rows.map((row) => {
    const granular = row.granularMetrics ?? row.granularity;
    const granularity = Array.isArray(granular)
      ? granular.map((entry) => {
          const day = entry as Record<string, unknown>;
          return { date: String(day.date ?? ""), ...aliasMetrics(day) };
        })
      : undefined;
    return {
      metadata: aliasMetadata<M>(row.metadata ?? row),
      total: aliasMetrics(row.totalMetrics ?? row.total ?? row),
      granularity,
    };
  });
}

export function bulkBody(items: unknown[]): { allowPartialSuccess: boolean; items: Array<{ correlationId: number; data: unknown }> } {
  return {
    allowPartialSuccess: true,
    items: items.map((data, correlationId) => ({ correlationId, data })),
  };
}

export function bulkEntities<T>(data: unknown): T[] {
  return asList<Record<string, unknown>>(data)
    .filter((item) => item.success !== false)
    .map((item) => (item.result ?? item) as T);
}

export function money(amount: string, currency: string): { amount: string; currency: string } {
  return { amount, currency };
}

export function dailyBudget(amount: string, currency: string): { value: { amount: string; currency: string } } {
  return { value: money(amount, currency) };
}

export function campaignDailyBudget(campaign: {
  dailyBudgetAmount?: { amount: string; currency: string } | null;
  dailyBudget?: { value?: { amount: string; currency: string }; amount?: string; currency?: string };
}): { amount: string; currency: string } | null {
  return campaign.dailyBudgetAmount
    ?? campaign.dailyBudget?.value
    ?? (campaign.dailyBudget?.amount && campaign.dailyBudget.currency
      ? { amount: campaign.dailyBudget.amount, currency: campaign.dailyBudget.currency }
      : null);
}

export function adGroupBid(adGroup: {
  defaultBidAmount?: { amount: string; currency: string } | null;
  bidStrategy?: { bid?: { amount: string; currency: string } };
}): { amount: string; currency: string } | null | undefined {
  return adGroup.defaultBidAmount ?? adGroup.bidStrategy?.bid;
}
