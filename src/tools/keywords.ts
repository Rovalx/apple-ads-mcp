import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "../client/api-client.js";
import type { ApiListResponse, ApiResponse, Keyword, NegativeKeyword } from "../types/apple-ads.js";
import type { ReportResponse } from "../types/reporting.js";
import { formatMetrics, formatMoney } from "../utils/formatters.js";
import { handleToolError } from "../utils/error-handler.js";
import { validateDate } from "../utils/validators.js";
import { buildV1Query, buildV1Report, bulkBody, bulkEntities, equalsFilter, mapKeywordStatus, money, normalizeReportRows } from "../utils/v1.js";

function keywordBid(kw: Keyword & { bid?: { amount: string; currency: string } | null }): { amount: string; currency: string } | null | undefined {
  return kw.bidAmount ?? kw.bid;
}

export function registerKeywordTools(server: McpServer, client: AppleAdsClient) {
  server.registerTool(
    "get_keyword_report",
    {
      title: "Keyword Performance Report",
      description: "Get keyword-level performance metrics: impressions, taps, installs, spend, CPA, CPT, and conversion rate per keyword. Essential for bid optimization — identify high-CPA keywords to lower bids or pause, and high-converting keywords to increase bids. Also includes impression share data in the raw JSON (insights.impressionShare). Use get_search_term_report for the actual user queries that triggered each keyword.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().optional().describe("Filter to a specific ad group"),
        startDate: z.string().describe("Start date (YYYY-MM-DD)"),
        endDate: z.string().describe("End date (YYYY-MM-DD)"),
        sortBy: z.string().optional().describe("Sort field: 'localSpend' (default), 'impressions', 'installs', 'avgCPA', 'taps'"),
        limit: z.number().optional().describe("Max rows (default 100)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, startDate, endDate, sortBy, limit }) => {
      try {
        validateDate(startDate, "startDate");
        validateDate(endDate, "endDate");

        const filters = [equalsFilter("campaignId", campaignId)];
        if (adGroupId) filters.push(equalsFilter("adGroupId", adGroupId));
        const resp = await client.post<ReportResponse<{ keywordId: number; keyword: string; matchType: string; bidAmount: { amount: string; currency: string } }>>(
          "/reports/apps/keywords/query",
          buildV1Report({
            startDate,
            endDate,
            limit: limit ?? 100,
            sortBy: sortBy ?? "localSpend",
            sortOrder: "DESCENDING",
            filters,
          })
        );
        const rows = normalizeReportRows<{ keywordId: number; keyword: string; matchType: string; bidAmount: { amount: string; currency: string } }>(resp.data);

        if (rows.length === 0) {
          return { content: [{ type: "text", text: "No keyword data found." }] };
        }

        const summaries = rows.map((row) => {
          return [
            `Keyword: "${row.metadata.keyword}" (${row.metadata.matchType}, ID: ${row.metadata.keywordId})`,
            `Bid: ${formatMoney(row.metadata.bidAmount)}`,
            formatMetrics(row.total),
          ].join("\n");
        });

        const text = [
          `Keyword Report (${startDate} to ${endDate}):`,
          `Showing ${rows.length} keywords sorted by ${sortBy ?? "localSpend"}`,
          "",
          ...summaries.map((s, i) => `--- Keyword ${i + 1} ---\n${s}`),
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

  server.registerTool(
    "list_targeting_keywords",
    {
      title: "List / Find Targeting Keywords",
      description: "List or search targeting keywords in a campaign. Provide adGroupId for keywords in a specific ad group, or omit to search across all ad groups. Returns keyword text, match type, bid, and status. Use get_keyword_report for performance metrics instead.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().optional().describe("Ad group ID (omit to search across all ad groups)"),
        limit: z.number().optional().describe("Max results (default 200)"),
        offset: z.number().optional().describe("Pagination offset"),
        sortBy: z.string().optional().describe("Field to sort by (e.g., 'id', 'text', 'status')"),
        sortOrder: z.enum(["ASCENDING", "DESCENDING"]).optional(),
        conditions: z.array(z.object({
          field: z.string(),
          operator: z.enum(["EQUALS", "GREATER_THAN", "LESS_THAN", "IN", "LIKE", "STARTSWITH", "CONTAINS", "NOT_EQUALS"]),
          values: z.array(z.string()),
        })).optional().describe("Filter conditions (e.g., [{field:'status', operator:'EQUALS', values:['ACTIVE']}])"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, limit, offset, sortBy, sortOrder, conditions }) => {
      try {
        const filters = [equalsFilter("campaignId", campaignId)];
        if (adGroupId) filters.push(equalsFilter("adGroupId", adGroupId));
        const resp = await client.post<ApiListResponse<Keyword>>(
          "/keywords/query",
          buildV1Query({ limit: limit ?? 200, offset, sortBy, sortOrder, conditions, filters })
        );

        const text = resp.data
          .map((kw) => `"${kw.text}" (${kw.matchType}, ID: ${kw.id}) — Bid: ${formatMoney(keywordBid(kw))} — Status: ${kw.status}`)
          .join("\n");

        return {
          content: [
            { type: "text", text: `${resp.data.length} targeting keywords:\n${text}` },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "list_negative_keywords",
    {
      title: "List / Find Negative Keywords",
      description: "List negative keywords at campaign or ad group level. Negative keywords prevent your ads from showing for specific search terms. Use get_search_term_report to identify wasteful terms, then add_negative_keywords to block them. Platform API v1 requires an adGroupId condition: an ad group id for that ad group, or adGroupId IS_NULL together with campaignId EQUALS for campaign-level negatives. Extra conditions are sent as filters.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().optional().describe("Ad group ID (omit for campaign-level negatives, which query adGroupId IS_NULL)"),
        limit: z.number().optional().describe("Max results (default 1000)"),
        offset: z.number().optional().describe("Pagination offset"),
        sortBy: z.string().optional().describe("Field to sort by"),
        sortOrder: z.enum(["ASCENDING", "DESCENDING"]).optional(),
        conditions: z.array(z.object({
          field: z.string(),
          operator: z.enum(["EQUALS", "GREATER_THAN", "LESS_THAN", "IN", "LIKE", "STARTSWITH", "CONTAINS", "NOT_EQUALS", "IS_NULL"]),
          values: z.array(z.string()),
        })).optional().describe("Additional filter conditions. Campaign-level listing already sends campaignId EQUALS and adGroupId IS_NULL."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, limit, offset, sortBy, sortOrder, conditions }) => {
      try {
        const filters = adGroupId
          ? [equalsFilter("adGroupId", adGroupId)]
          : [
              equalsFilter("campaignId", campaignId),
              { field: "adGroupId", operator: "IS_NULL" },
            ];
        const resp = await client.post<ApiListResponse<NegativeKeyword>>(
          "/negative-keywords/query",
          buildV1Query({ limit: limit ?? 1000, offset, sortBy, sortOrder, conditions, filters })
        );

        const text = resp.data
          .map((kw) => {
            const parts = [`"${kw.text}" (${kw.matchType}, ID: ${kw.id})`];
            if (kw.adGroupId) parts.push(`Ad Group: ${kw.adGroupId}`);
            parts.push(`Status: ${kw.status}`);
            return parts.join(" — ");
          })
          .join("\n");

        const level = adGroupId ? `ad group ${adGroupId}` : `campaign ${campaignId}`;
        return {
          content: [
            { type: "text", text: `${resp.data.length} negative keywords at ${level} level:\n${text}` },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "delete_targeting_keywords",
    {
      title: "Delete Targeting Keywords",
      description: "Delete targeting keywords. Platform API v1 uses POST /v1/keywords/bulk-delete (soft delete). campaignId and adGroupId are kept so existing calls still work; the API deletes by keyword id. Consider pausing instead (update_targeting_keywords with status=PAUSED) to preserve bid history.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().describe("The ad group ID"),
        keywordIds: z.array(z.number()).describe("Array of keyword IDs to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, keywordIds }) => {
      try {
        await client.post<unknown>(
          "/keywords/bulk-delete",
          bulkBody(keywordIds.map((id) => ({ id })))
        );
        return {
          content: [{ type: "text", text: `Deleted ${keywordIds.length} targeting keyword(s) from ad group ${adGroupId}.` }],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "delete_negative_keywords",
    {
      title: "Delete Negative Keywords",
      description: "Delete negative keywords. Platform API v1 uses one negative-keyword resource and POST /v1/negative-keywords/bulk-delete, scoped by the keyword id rather than a campaign or ad-group path. campaignId and adGroupId are accepted so existing calls keep working.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().optional().describe("Ad group ID (omit for campaign-level)"),
        keywordIds: z.array(z.number()).describe("Array of negative keyword IDs to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, keywordIds }) => {
      try {
        await client.post<unknown>(
          "/negative-keywords/bulk-delete",
          bulkBody(keywordIds.map((id) => ({ id })))
        );
        const level = adGroupId ? `ad group ${adGroupId}` : `campaign ${campaignId}`;
        return {
          content: [{ type: "text", text: `Deleted ${keywordIds.length} negative keyword(s) at ${level} level.` }],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "update_targeting_keywords",
    {
      title: "Update Targeting Keywords (Bulk)",
      description: "Update targeting keywords in bulk — change status (ACTIVE or PAUSED; ACTIVE is sent as ENABLED) and/or bid amounts. Calls POST /v1/keywords/bulk-update. Pass an array of 1 for a single keyword. Bid changes take effect immediately.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().describe("The ad group ID"),
        keywords: z
          .array(
            z.object({
              keywordId: z.number().describe("The keyword ID to update"),
              status: z.enum(["ACTIVE", "PAUSED"]).optional().describe("New status"),
              bidAmount: z.string().optional().describe("New bid amount (e.g., '1.50')"),
            })
          )
          .describe("Keywords to update"),
        currency: z.string().optional().describe("Currency code (default USD)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, keywords, currency }) => {
      try {
        const cur = currency ?? "USD";
        const resp = await client.post<ApiListResponse<Keyword>>(
          "/keywords/bulk-update",
          bulkBody(keywords.map((kw) => {
            const data: Record<string, unknown> = { id: kw.keywordId };
            if (kw.status) data.status = mapKeywordStatus(kw.status);
            if (kw.bidAmount) data.bid = money(kw.bidAmount, cur);
            return data;
          }))
        );
        const updated = bulkEntities<Keyword>(resp.data);

        const summaries = updated.map(
          (kw) => `"${kw.text}" — Status: ${kw.status}, Bid: ${formatMoney(keywordBid(kw))}`
        );

        return {
          content: [
            { type: "text", text: `Updated ${updated.length} keyword(s):\n${summaries.join("\n")}` },
            { type: "text", text: JSON.stringify(updated, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "add_targeting_keywords",
    {
      title: "Add Targeting Keywords",
      description: `Add new targeting keywords to an ad group. Keywords determine which App Store search queries trigger your ads.

Match types: EXACT matches the exact query only (higher relevance, lower volume). BROAD matches related queries and synonyms (higher volume, may need negatives). Start with EXACT for proven terms and BROAD for discovery, then use get_search_term_report to refine.`,
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().describe("The ad group ID"),
        keywords: z
          .array(
            z.object({
              text: z.string().describe("The keyword text (e.g., 'photo editor')"),
              matchType: z.enum(["BROAD", "EXACT"]).describe("EXACT for precise matching, BROAD for synonyms/related"),
              bidAmount: z.string().describe("Max CPC bid (e.g., '1.00')"),
            })
          )
          .describe("Keywords to add"),
        currency: z.string().optional().describe("Currency code (default 'USD')"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, keywords, currency }) => {
      try {
        const cur = currency ?? "USD";
        const resp = await client.post<ApiListResponse<Keyword>>(
          "/keywords/bulk-create",
          bulkBody(keywords.map((kw) => ({
            adGroupId,
            text: kw.text,
            matchType: kw.matchType,
            status: "ENABLED",
            bid: money(kw.bidAmount, cur),
          })))
        );
        const created = bulkEntities<Keyword>(resp.data);

        return {
          content: [
            { type: "text", text: `Added ${created.length} keywords to ad group ${adGroupId}.` },
            { type: "text", text: JSON.stringify(created, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "get_targeting_keyword",
    {
      title: "Get Targeting Keyword",
      description: "Get details of a specific targeting keyword: text, match type, bid amount, and status. Use get_keyword_report for performance metrics.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().describe("The ad group ID"),
        keywordId: z.number().describe("The keyword ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, keywordId }) => {
      try {
        const resp = await client.get<ApiResponse<Keyword>>(`/keywords/${keywordId}`);
        const kw = resp.data;

        return {
          content: [
            { type: "text", text: `Keyword: "${kw.text}" (${kw.matchType}, ID: ${kw.id})\nBid: ${formatMoney(keywordBid(kw))}\nStatus: ${kw.status}` },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "get_negative_keyword",
    {
      title: "Get Negative Keyword",
      description: "Get details of a specific negative keyword by ID at the campaign or ad group level.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().optional().describe("Ad group ID (omit for campaign-level negative keyword)"),
        keywordId: z.number().describe("The negative keyword ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, keywordId }) => {
      try {
        const resp = await client.get<ApiResponse<NegativeKeyword>>(`/negative-keywords/${keywordId}`);
        const kw = resp.data;
        const level = adGroupId ? `ad group ${adGroupId}` : `campaign ${campaignId}`;

        return {
          content: [
            { type: "text", text: `Negative Keyword (${level}): "${kw.text}" (${kw.matchType}, ID: ${kw.id})\nStatus: ${kw.status}` },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "update_negative_keywords",
    {
      title: "Update Negative Keywords (Bulk)",
      description: "Update negative keywords in bulk. Platform API v1 uses POST /v1/negative-keywords/bulk-update on one resource; campaign or ad-group scope is on the keyword itself. ACTIVE is sent as ENABLED. Pausing a negative keyword allows the previously blocked search term to trigger ads again.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().optional().describe("Ad group ID (omit for campaign-level)"),
        keywords: z.array(z.object({
          keywordId: z.number().describe("The negative keyword ID to update"),
          status: z.enum(["ACTIVE", "PAUSED"]).optional().describe("New status"),
          matchType: z.enum(["BROAD", "EXACT"]).optional().describe("New match type"),
          text: z.string().optional().describe("New keyword text"),
        })).describe("Negative keywords to update"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, keywords }) => {
      try {
        const resp = await client.post<ApiListResponse<NegativeKeyword>>(
          "/negative-keywords/bulk-update",
          bulkBody(keywords.map((kw) => {
            const data: Record<string, unknown> = { id: kw.keywordId };
            if (kw.status) data.status = mapKeywordStatus(kw.status);
            if (kw.matchType) data.matchType = kw.matchType;
            if (kw.text) data.text = kw.text;
            return data;
          }))
        );
        const updated = bulkEntities<NegativeKeyword>(resp.data);
        const level = adGroupId ? `ad group ${adGroupId}` : `campaign ${campaignId}`;

        const summaries = updated.map(
          (kw) => `"${kw.text}" (${kw.matchType}) — Status: ${kw.status}`
        );

        return {
          content: [
            { type: "text", text: `Updated ${updated.length} negative keyword(s) at ${level} level:\n${summaries.join("\n")}` },
            { type: "text", text: JSON.stringify(updated, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "add_negative_keywords",
    {
      title: "Add Negative Keywords",
      description: "Add negative keywords to block wasteful search terms from triggering your ads. Campaign-level negatives block across all ad groups; ad-group-level negatives only block within that ad group. Use get_search_term_report to identify high-spend/low-conversion terms to block.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        adGroupId: z.number().optional().describe("Ad group ID (omit for campaign-level — blocks across ALL ad groups)"),
        keywords: z
          .array(
            z.object({
              text: z.string().describe("The keyword text to block"),
              matchType: z.enum(["BROAD", "EXACT"]).describe("EXACT blocks only this exact term, BROAD blocks variations too"),
            })
          )
          .describe("Negative keywords to add"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ campaignId, adGroupId, keywords }) => {
      try {
        const resp = await client.post<ApiListResponse<NegativeKeyword>>(
          "/negative-keywords/bulk-create",
          bulkBody(keywords.map((kw) => {
            const data: Record<string, unknown> = {
              text: kw.text,
              matchType: kw.matchType,
              status: "ENABLED",
            };
            if (adGroupId) data.adGroupId = adGroupId;
            else data.campaignId = campaignId;
            return data;
          }))
        );
        const created = bulkEntities<NegativeKeyword>(resp.data);

        const level = adGroupId ? `ad group ${adGroupId}` : `campaign ${campaignId}`;
        return {
          content: [
            { type: "text", text: `Added ${created.length} negative keywords at ${level} level.` },
            { type: "text", text: JSON.stringify(created, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
