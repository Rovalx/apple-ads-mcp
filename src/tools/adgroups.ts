import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "../client/api-client.js";
import type { ApiListResponse, ApiResponse, AdGroup } from "../types/apple-ads.js";
import type { ReportResponse } from "../types/reporting.js";
import { formatEntityStatus, formatMetrics, formatMoney } from "../utils/formatters.js";
import { toISO8601 } from "../utils/date-helpers.js";
import { handleToolError } from "../utils/error-handler.js";
import { validateDate, validateMonthlyRange } from "../utils/validators.js";
import { adGroupBid, buildV1Query, buildV1Report, equalsFilter, money, normalizeReportRows } from "../utils/v1.js";

export function registerAdGroupTools(server: McpServer, client: AppleAdsClient) {
  server.registerTool(
    "list_ad_groups",
    {
      title: "List / Find Ad Groups",
      description: "List or search ad groups. Provide campaignId to scope to one campaign, or omit to search across all campaigns (org-level). Supports filtering by conditions (e.g., status, defaultBidAmount) and sorting. Returns ad group ID, name, status, default bid, CPA goal, and Search Match (automatedKeywordsOptIn).",
      inputSchema: {
        campaignId: z.number().optional().describe("Campaign ID (omit to search across all campaigns)"),
        limit: z.number().optional().describe("Max results (default 50)"),
        offset: z.number().optional().describe("Pagination offset"),
        sortBy: z.string().optional().describe("Field to sort by (e.g., 'id', 'name', 'status', 'defaultBidAmount')"),
        sortOrder: z.enum(["ASCENDING", "DESCENDING"]).optional(),
        conditions: z.array(z.object({
          field: z.string(),
          operator: z.enum(["EQUALS", "GREATER_THAN", "LESS_THAN", "IN", "LIKE", "STARTSWITH", "CONTAINS", "NOT_EQUALS"]),
          values: z.array(z.string()),
        })).optional().describe("Filter conditions"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, limit, offset, sortBy, sortOrder, conditions }) => {
      try {
        const filters = campaignId ? [equalsFilter("campaignId", campaignId)] : undefined;
        const resp = await client.post<ApiListResponse<AdGroup>>(
          "/adgroups/query",
          buildV1Query({ limit: limit ?? 50, offset, sortBy, sortOrder, conditions, filters })
        );

        const summaries = resp.data.map((ag) =>
          [
            `Ad Group: ${ag.name} (ID: ${ag.id})`,
            ag.campaignId ? `Campaign ID: ${ag.campaignId}` : null,
            formatEntityStatus(ag),
            `Default Bid: ${formatMoney(adGroupBid(ag))}`,
            ag.cpaGoal ? `CPA Goal: ${formatMoney(ag.cpaGoal)}` : null,
            `Search Match: ${ag.automatedKeywordsOptIn ? "on" : "off"}`,
          ]
            .filter(Boolean)
            .join("\n")
        );

        const scope = campaignId ? `campaign ${campaignId}` : "all campaigns";
        const text = [
          `Found ${resp.data.length} ad groups in ${scope} (total: ${resp.pagination?.totalResults ?? resp.data.length}):`,
          "",
          ...summaries.map((s, i) => `--- Ad Group ${i + 1} ---\n${s}`),
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
    "create_ad_group",
    {
      title: "Create Ad Group",
      description: `Create a new ad group within a campaign. After creation, add targeting keywords (add_targeting_keywords) to start matching search queries. Optionally create ads with custom creatives (create_ad).

Defaults: status=ENABLED, pricingModel=CPT, startTime=today, Search Match off unless automatedKeywordsOptIn is set. defaultBidAmount is sent as bidStrategy.bid. cpaGoal is sent as bidStrategy.targetCPA when provided (v5 cpaCap is sunset; prefer not to rely on it). startTime and endTime are sent as YYYY-MM-DDT00:00:00.000. campaignId is in the body, not the path.`,
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        name: z.string().describe("Ad group name"),
        defaultBidAmount: z.string().describe("Default CPC bid (e.g., '1.00'). Used for keywords without individual bids"),
        currency: z.string().optional().describe("Currency code (default 'USD')"),
        cpaGoal: z.string().optional().describe("CPA goal — enables Apple's CPA optimization algorithm"),
        startTime: z.string().optional().describe("Start time (YYYY-MM-DD, default today). Sent as YYYY-MM-DDT00:00:00.000"),
        endTime: z.string().optional().describe("End time (YYYY-MM-DD). Sent as YYYY-MM-DDT00:00:00.000"),
        status: z.enum(["ENABLED", "PAUSED"]).optional().describe("Initial status (default 'ENABLED')"),
        automatedKeywordsOptIn: z.boolean().optional().describe("Search Match on/off (automatedKeywordsOptIn). Omit to leave Apple's default (false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ campaignId, name, defaultBidAmount, currency, cpaGoal, startTime, endTime, status, automatedKeywordsOptIn }) => {
      try {
        if (startTime) validateDate(startTime, "startTime");
        if (endTime) validateDate(endTime, "endTime");

        const cur = currency ?? "USD";
        const bidStrategy: Record<string, unknown> = {
          bidStrategyType: "MANUAL_CPT",
          bidStrategyGoal: "TAP",
          bid: money(defaultBidAmount, cur),
        };
        if (cpaGoal) bidStrategy.targetCPA = money(cpaGoal, cur);
        const body: Record<string, unknown> = {
          campaignId,
          name,
          pricingModel: "CPT",
          status: status ?? "ENABLED",
          startTime: toISO8601(startTime ?? new Date().toISOString().split("T")[0]!),
          bidStrategy,
        };
        if (endTime) body.endTime = toISO8601(endTime);
        if (automatedKeywordsOptIn !== undefined) body.automatedKeywordsOptIn = automatedKeywordsOptIn;

        const resp = await client.post<ApiResponse<AdGroup>>("/adgroups", body);
        return {
          content: [
            { type: "text", text: `Created ad group "${resp.data.name}" (ID: ${resp.data.id}) in campaign ${campaignId}. Next: add_targeting_keywords` },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "update_ad_group",
    {
      title: "Update Ad Group",
      description: "Update an ad group's configuration. Only provided fields are changed. Changing defaultBidAmount affects all keywords that don't have individual bids. Setting status to PAUSED stops delivery for this ad group only. Set automatedKeywordsOptIn to turn Search Match on or off. endTime is sent as a full date-time (YYYY-MM-DDT00:00:00.000).",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().describe("The ad group ID"),
        name: z.string().optional().describe("New name"),
        status: z.enum(["ENABLED", "PAUSED"]).optional().describe("New status"),
        defaultBidAmount: z.string().optional().describe("New default bid — affects keywords without individual bids"),
        cpaGoal: z.string().optional().describe("New CPA goal"),
        currency: z.string().optional().describe("Currency code (default 'USD')"),
        endTime: z.string().optional().describe("New end time (YYYY-MM-DD). Sent as YYYY-MM-DDT00:00:00.000"),
        automatedKeywordsOptIn: z.boolean().optional().describe("Search Match on/off (automatedKeywordsOptIn)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, name, status, defaultBidAmount, cpaGoal, currency, endTime, automatedKeywordsOptIn }) => {
      try {
        if (endTime) validateDate(endTime, "endTime");

        const cur = currency ?? "USD";
        const body: Record<string, unknown> = {};
        if (name) body.name = name;
        if (status) body.status = status;
        if (defaultBidAmount || cpaGoal) {
          const bidStrategy: Record<string, unknown> = { bidStrategyType: "MANUAL_CPT", bidStrategyGoal: "TAP" };
          if (defaultBidAmount) bidStrategy.bid = money(defaultBidAmount, cur);
          if (cpaGoal) bidStrategy.targetCPA = money(cpaGoal, cur);
          body.bidStrategy = bidStrategy;
        }
        if (endTime) body.endTime = toISO8601(endTime);
        if (automatedKeywordsOptIn !== undefined) body.automatedKeywordsOptIn = automatedKeywordsOptIn;

        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No changes specified." }] };
        }

        const resp = await client.put<ApiResponse<AdGroup>>(`/adgroups/${adGroupId}`, body);
        return {
          content: [
            { type: "text", text: `Updated ad group "${resp.data.name}" (ID: ${resp.data.id})` },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "delete_ad_group",
    {
      title: "Delete Ad Group",
      description: "Permanently delete an ad group and all its keywords and ads. This action CANNOT be undone. Consider pausing instead (update_ad_group with status=PAUSED) to preserve data.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().describe("The ad group ID to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ campaignId, adGroupId }) => {
      try {
        await client.delete<unknown>(`/adgroups/${adGroupId}`);
        return {
          content: [{ type: "text", text: `Deleted ad group ${adGroupId} from campaign ${campaignId}.` }],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "get_ad_group",
    {
      title: "Get Ad Group Details",
      description: "Get full configuration of a specific ad group: bid settings, CPA goal, Search Match (automatedKeywordsOptIn), status, and scheduling. Use get_adgroup_report for performance metrics.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().describe("The ad group ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, adGroupId }) => {
      try {
        const resp = await client.get<ApiResponse<AdGroup>>(`/adgroups/${adGroupId}`);
        const ag = resp.data;
        const text = [
          `Ad Group: ${ag.name} (ID: ${ag.id})`,
          formatEntityStatus(ag),
          `Default Bid: ${formatMoney(adGroupBid(ag))}`,
          ag.cpaGoal ? `CPA Goal: ${formatMoney(ag.cpaGoal)}` : null,
          `Search Match: ${ag.automatedKeywordsOptIn ? "on" : "off"}`,
        ].filter(Boolean).join("\n");

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
    "get_adgroup_report",
    {
      title: "Ad Group Performance Report",
      description: "Get performance metrics for ad groups within a campaign. Compare ad group performance to identify which targeting strategies work best. Returns impressions, taps, installs, spend, CPA, CPT per ad group. Drill down further with get_keyword_report.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        startDate: z.string().describe("Start date (YYYY-MM-DD)"),
        endDate: z.string().describe("End date (YYYY-MM-DD)"),
        granularity: z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]).optional().describe("Time granularity (default DAILY). MONTHLY requires a whole-month range: start on YYYY-MM-01 and end on the last day of a month."),
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
          filters: [equalsFilter("campaignId", campaignId)],
        });

        const resp = await client.post<ReportResponse<{ adGroupId: number; adGroupName: string }>>(
          "/reports/apps/adgroups/query",
          reportReq
        );
        const rows = normalizeReportRows<{ adGroupId: number; adGroupName: string; name?: string; id?: number }>(resp.data);

        if (rows.length === 0) {
          return { content: [{ type: "text", text: "No ad group data found for the specified date range." }] };
        }

        const summaries = rows.map((row) => {
          return [
            `Ad Group: ${row.metadata.adGroupName ?? row.metadata.name} (ID: ${row.metadata.adGroupId ?? row.metadata.id})`,
            formatMetrics(row.total),
          ].join("\n");
        });

        const text = [
          `Ad Group Report for Campaign ${campaignId} (${startDate} to ${endDate}):`,
          "",
          ...summaries.map((s, i) => `--- Ad Group ${i + 1} ---\n${s}`),
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
