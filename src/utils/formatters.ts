import type { MetricData } from "../types/reporting.js";
import type { Ad, BudgetOrder, Campaign, Creative, Money } from "../types/apple-ads.js";

export function formatMoney(m: Money | { amount: string; currency: string } | null | undefined): string {
  if (!m || m.amount == null || m.currency == null) return "N/A";
  const amount = parseFloat(m.amount);
  if (isNaN(amount)) return "N/A";
  return `${m.currency} ${amount.toFixed(2)}`;
}

export function formatMetrics(m: MetricData): string {
  const lines = [
    `Impressions: ${(m.impressions ?? 0).toLocaleString()}`,
    `Taps: ${(m.taps ?? 0).toLocaleString()}`,
    `TTR: ${((m.ttr ?? 0) * 100).toFixed(2)}%`,
    `Installs: ${(m.totalInstalls ?? 0).toLocaleString()}`,
    `New Downloads: ${(m.totalNewDownloads ?? 0).toLocaleString()}`,
    `Redownloads: ${(m.totalRedownloads ?? 0).toLocaleString()}`,
    `Conversion Rate: ${((m.conversionRate ?? 0) * 100).toFixed(2)}%`,
    `Avg CPA: ${formatMoney(m.avgCPA)}`,
    `Avg CPT: ${formatMoney(m.avgCPT)}`,
    `Spend: ${formatMoney(m.localSpend)}`,
  ];
  return lines.join("\n");
}

export function formatCampaignSummary(c: Campaign): string {
  const v1 = c as Campaign & {
    dailyBudget?: { value?: { amount: string; currency: string } };
    targeting?: { countryOrRegion?: { include?: string[] } };
    promotedObjectId?: string | number;
    systemStatus?: string;
  };
  const daily = c.dailyBudgetAmount ?? v1.dailyBudget?.value ?? null;
  const countries = c.countriesOrRegions ?? v1.targeting?.countryOrRegion?.include;
  const adamId = c.adamId ?? v1.promotedObjectId;
  const status = c.displayStatus ?? v1.systemStatus ?? c.status;
  const budgetLine = c.budgetAmount
    ? `Budget: ${formatMoney(c.budgetAmount)} (Daily: ${formatMoney(daily)})`
    : `Daily budget: ${formatMoney(daily)} (lifetime budget is not used on Platform API v1)`;
  return [
    `Campaign: ${c.name} (ID: ${c.id})`,
    `Status: ${status}`,
    budgetLine,
    `Countries: ${countries?.join(", ") ?? "N/A"}`,
    `App Adam ID: ${adamId ?? "N/A"}`,
  ].join("\n");
}

export function formatAdSummary(ad: Ad): string {
  return [
    `Ad: ${ad.name} (ID: ${ad.id})`,
    `Status: ${ad.servingStatus}`,
    `Creative ID: ${ad.creativeId}`,
    `Campaign ID: ${ad.campaignId}, Ad Group ID: ${ad.adGroupId}`,
    ad.rejectionReasons?.length
      ? `Rejection Reasons: ${ad.rejectionReasons.map((r) => r.message).join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatBudgetOrderSummary(bo: BudgetOrder): string {
  return [
    `Budget Order: ${bo.name} (ID: ${bo.id})`,
    `Status: ${bo.status}`,
    `Budget: ${formatMoney(bo.budget ?? (bo as BudgetOrder & { value?: { amount: string; currency: string } }).value)}`,
    `Start: ${bo.startDate ?? (bo as BudgetOrder & { startTime?: string }).startTime ?? "N/A"}`,
    (bo.endDate ?? (bo as BudgetOrder & { endTime?: string }).endTime)
      ? `End: ${bo.endDate ?? (bo as BudgetOrder & { endTime?: string }).endTime}`
      : null,
    bo.orderNumber ? `Order #: ${bo.orderNumber}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatCreativeSummary(c: Creative): string {
  return [
    `Creative: ${c.name} (ID: ${c.id})`,
    `Type: ${c.type ?? (c as Creative & { creativeType?: string }).creativeType ?? "N/A"}`,
    `State: ${c.state ?? (c as Creative & { systemStatus?: string }).systemStatus ?? "N/A"}`,
    `Adam ID: ${c.adamId}`,
  ].join("\n");
}
