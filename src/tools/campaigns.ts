import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "../client/api-client.js";
import type { ApiListResponse, ApiResponse, Campaign } from "../types/apple-ads.js";
import type { ReportResponse } from "../types/reporting.js";
import { formatCampaignSummary, formatMetrics, formatShownTotal } from "../utils/formatters.js";
import { handleToolError } from "../utils/error-handler.js";
import { validateDate, validateMonthlyRange } from "../utils/validators.js";
import { toISO8601 } from "../utils/date-helpers.js";
import { buildV1Query, buildV1Report, dailyBudget, equalsFilter, normalizeReportRows } from "../utils/v1.js";

export function registerCampaignTools(server: McpServer, client: AppleAdsClient) {
  server.registerTool(
    "list_campaigns",
    {
      title: "List / Find Campaigns",
      description: "List or search campaigns in the selected ad account (POST /v1/campaigns/query). Returns campaign ID, name, status, daily budget, countries, and supply placements. Use without parameters for a quick overview. Add conditions to filter (e.g., status=ENABLED) or sortBy to rank results. Select an ad account with list_ad_accounts and switch_ad_account first.",
      inputSchema: {
        limit: z.number().optional().describe("Max campaigns to return (default 50)"),
        offset: z.number().optional().describe("Pagination offset"),
        sortBy: z.string().optional().describe("Field to sort by (e.g., 'id', 'name', 'status', 'budgetAmount')"),
        sortOrder: z.enum(["ASCENDING", "DESCENDING"]).optional(),
        conditions: z.array(z.object({
          field: z.string(),
          operator: z.enum(["EQUALS", "GREATER_THAN", "LESS_THAN", "IN", "LIKE", "STARTSWITH", "CONTAINS", "NOT_EQUALS"]),
          values: z.array(z.string()),
        })).optional().describe("Filter conditions (e.g., [{field:'status', operator:'EQUALS', values:['ENABLED']}])"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ limit, offset, sortBy, sortOrder, conditions }) => {
      try {
        const resp = await client.post<ApiListResponse<Campaign>>(
          "/campaigns/query",
          buildV1Query({ limit: limit ?? 50, offset, sortBy, sortOrder, conditions })
        );

        const summaries = resp.data.map(formatCampaignSummary);
        const text = [
          `Found ${resp.data.length} campaigns (${formatShownTotal(resp.data.length, resp.pagination?.totalResults)}):`,
          "",
          ...summaries.map((s, i) => `--- Campaign ${i + 1} ---\n${s}`),
        ].join("\n");

        return {
          content: [
            { type: "text", text },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "get_campaign_details",
    {
      title: "Get Campaign Details",
      description: "Get full configuration of a specific campaign: targeting settings, budgets (total + daily), countries, supply sources, billing event, and status. Use get_campaign_report for performance metrics instead.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId }) => {
      try {
        const resp = await client.get<ApiResponse<Campaign>>(`/campaigns/${campaignId}`);
        const summary = formatCampaignSummary(resp.data);

        return {
          content: [
            { type: "text", text: summary },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "create_campaign",
    {
      title: "Create Campaign",
      description: `Create a new Apple Search Ads campaign. After creation, you MUST create at least one ad group (create_ad_group) and add keywords (add_targeting_keywords) before the campaign can serve ads.

Defaults applied: status=ENABLED, currency=USD, supplySource=APPSTORE_SEARCH_RESULTS. adChannelType and billingEvent are auto-set based on supply source (SEARCH/TAPS for search results, DISPLAY/IMPRESSIONS for search tab).

Platform API v1 deprecates lifetime budget. budgetAmount is accepted for compatibility and is never sent. Only dailyBudget is sent as dailyBudgetAmount. The app adamId is sent as promotedObjectId with promotedObjectType APPSTORE_APP.

Side effects: Campaign starts spending immediately if status=ENABLED and budget > 0. Use status=PAUSED to set up everything before going live.`,
      inputSchema: {
        name: z.string().describe("Campaign name"),
        adamId: z.number().describe("App Adam ID (use search_apps to find it)"),
        budgetAmount: z.string().optional().describe("Ignored. Platform API v1 deprecated lifetime budget (v5 LIFETIME_BUDGET_NOT_SUPPORTED). Only dailyBudgetAmount is sent."),
        dailyBudgetAmount: z.string().describe("Daily budget cap (e.g., '100.00')"),
        countriesOrRegions: z.array(z.string()).describe("Country/region codes (e.g., ['US', 'GB']). Use the apple-ads://countries resource for valid codes"),
        currency: z.string().optional().describe("Currency code (default 'USD')"),
        supplySources: z.array(z.string()).optional().describe("Supply sources: 'APPSTORE_SEARCH_RESULTS' (default) or 'APPSTORE_SEARCH_TAB'"),
        status: z.enum(["ENABLED", "PAUSED"]).optional().describe("Initial status (default 'ENABLED'). Use PAUSED to configure before launch"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, adamId, budgetAmount, dailyBudgetAmount, countriesOrRegions, currency, supplySources, status }) => {
      try {
        const cur = currency ?? "USD";
        const resolvedSources = supplySources ?? ["APPSTORE_SEARCH_RESULTS"];
        const searchTab = resolvedSources.includes("APPSTORE_SEARCH_TAB");
        const adAccountId = client.getAdAccountId();
        const body: Record<string, unknown> = {
          name,
          ...(adAccountId ? { adAccountId: Number(adAccountId) } : {}),
          status: status ?? "ENABLED",
          promotedObjectType: "APPSTORE_APP",
          promotedObjectId: String(adamId),
          startTime: toISO8601(new Date().toISOString().split("T")[0]!),
          billingEvent: searchTab ? "IMPRESSIONS" : "TAPS",
          bidStrategy: {
            bidStrategyType: "MANUAL_CPT",
            bidStrategyGoal: searchTab ? "IMPRESSION" : "TAP",
          },
          dailyBudget: dailyBudget(dailyBudgetAmount, cur),
          targeting: {
            supplyPlacement: { include: resolvedSources },
            countryOrRegion: { include: countriesOrRegions },
          },
        };
        const lifetimeNote = budgetAmount?.trim()
          ? " Lifetime budget was not sent; Platform API v1 deprecated it."
          : "";

        const resp = await client.post<ApiResponse<Campaign>>("/campaigns", body);
        return {
          content: [
            { type: "text", text: `Created campaign "${resp.data.name}" (ID: ${resp.data.id}). Next steps: create_ad_group → add_targeting_keywords.${lifetimeNote}` },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "update_campaign",
    {
      title: "Update Campaign",
      description: `Update a campaign's configuration. Only provided fields are changed; omitted fields are left unchanged.

Important: changing countriesOrRegions will clear existing geo targeting (ad-group-level locality/admin area targets). Budget changes take effect immediately. Setting status to PAUSED stops all ad delivery.`,
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        name: z.string().optional().describe("New campaign name"),
        status: z.enum(["ENABLED", "PAUSED"]).optional().describe("New status — PAUSED stops all delivery immediately"),
        budgetAmount: z.string().optional().describe("Ignored. Platform API v1 has no lifetime budget field."),
        dailyBudgetAmount: z.string().optional().describe("New daily budget cap (e.g., '1.50')"),
        countriesOrRegions: z.array(z.string()).optional().describe("New country/region codes — WARNING: clears geo targeting"),
        currency: z.string().optional().describe("Currency code (default 'USD')"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, name, status, budgetAmount, dailyBudgetAmount, countriesOrRegions, currency }) => {
      try {
        const cur = currency ?? "USD";
        const body: Record<string, unknown> = {};
        if (name) body.name = name;
        if (status) body.status = status;
        if (dailyBudgetAmount) body.dailyBudget = dailyBudget(dailyBudgetAmount, cur);
        if (countriesOrRegions) body.targeting = { countryOrRegion: { include: countriesOrRegions } };

        if (Object.keys(body).length === 0) {
          const ignored = budgetAmount?.trim() ? " Lifetime budget was not sent; Platform API v1 deprecated it." : "";
          return { content: [{ type: "text", text: `No changes specified.${ignored}` }] };
        }

        const resp = await client.put<ApiResponse<Campaign>>(`/campaigns/${campaignId}`, body);
        return {
          content: [
            { type: "text", text: `Updated campaign "${resp.data.name}" (ID: ${resp.data.id})` },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "delete_campaign",
    {
      title: "Delete Campaign",
      description: "Permanently delete a campaign and all its child ad groups, keywords, and ads. This action CANNOT be undone. The campaign must be paused before deletion. Consider pausing instead if you might need the data later.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ campaignId }) => {
      try {
        await client.delete<unknown>(`/campaigns/${campaignId}`);
        return {
          content: [{ type: "text", text: `Deleted campaign ${campaignId}.` }],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "get_campaign_report",
    {
      title: "Campaign Performance Report",
      description: "Get performance metrics for one or all campaigns over a date range. Returns impressions, taps, installs, spend, CPA, CPT, TTR, and conversion rates. Use for high-level performance analysis. For deeper analysis, drill down with get_adgroup_report or get_keyword_report. A campaignId filter is sent as field id on POST /v1/reports/apps/campaigns/query (that endpoint rejects campaignId). MONTHLY requires the range to start on the 1st and end on the last day of a month.",
      inputSchema: {
        campaignId: z.number().optional().describe("Filter to a specific campaign (omit for all campaigns). Sent as filter field id."),
        startDate: z.string().describe("Start date (YYYY-MM-DD)"),
        endDate: z.string().describe("End date (YYYY-MM-DD)"),
        granularity: z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]).optional().describe("Time granularity (default DAILY). MONTHLY requires startDate YYYY-MM-01 and endDate on the last day of a month."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, startDate, endDate, granularity }) => {
      try {
        validateDate(startDate, "startDate");
        validateDate(endDate, "endDate");
        validateMonthlyRange(startDate, endDate, granularity);

        const reportReq = buildV1Report({
          startDate,
          endDate,
          granularity: granularity ?? "DAILY",
          limit: 1000,
          sortBy: "localSpend",
          sortOrder: "DESCENDING",
          filters: campaignId ? [equalsFilter("id", campaignId)] : undefined,
          includeGrandTotal: true,
        });

        const resp = await client.post<ReportResponse<{ campaignId: number; campaignName: string }>>(
          "/reports/apps/campaigns/query",
          reportReq
        );
        const rows = normalizeReportRows<{ campaignId: number; campaignName: string }>(resp.data);

        if (rows.length === 0) {
          return { content: [{ type: "text", text: "No data found for the specified date range." }] };
        }

        const summaries = rows.map((row) => {
          const meta = row.metadata;
          return [
            `Campaign: ${meta.campaignName} (ID: ${meta.campaignId})`,
            formatMetrics(row.total),
          ].join("\n");
        });

        const text = [
          `Campaign Report (${startDate} to ${endDate}):`,
          "",
          ...summaries.map((s, i) => `--- Campaign ${i + 1} ---\n${s}`),
        ].join("\n");

        return {
          content: [
            { type: "text", text },
            { type: "text", text: JSON.stringify(rows, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
