import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "../client/api-client.js";
import type { ReportResponse } from "../types/reporting.js";
import { formatMetrics } from "../utils/formatters.js";
import { handleToolError } from "../utils/error-handler.js";
import { validateDate } from "../utils/validators.js";
import { buildV1Report, equalsFilter, normalizeReportRows } from "../utils/v1.js";

interface SearchTermMetadata {
  searchTermText: string;
  searchTermSource: string;
  keywordId: number;
  keyword: string;
  matchType: string;
  adGroupId: number;
  adGroupName: string;
}

export function registerSearchTermTools(server: McpServer, client: AppleAdsClient) {
  server.registerTool(
    "get_search_term_report",
    {
      title: "Search Term Report",
      description: "Get actual user search queries that triggered your ads, with full performance metrics. THIS IS THE MOST VALUABLE TOOL for keyword optimization — reveals which search terms convert well (add as keywords), which waste money (add as negatives), and which keywords trigger irrelevant searches.",
      inputSchema: {
        campaignId: z.number().describe("The campaign ID"),
        startDate: z.string().describe("Start date (YYYY-MM-DD)"),
        endDate: z.string().describe("End date (YYYY-MM-DD)"),
        sortBy: z.string().optional().describe("Sort field: 'localSpend', 'impressions', 'installs', 'avgCPA' (default: localSpend)"),
        limit: z.number().optional().describe("Max rows to return (default 100)"),
        adGroupId: z.number().optional().describe("Filter to a specific ad group"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaignId, startDate, endDate, sortBy, limit, adGroupId }) => {
      try {
        validateDate(startDate, "startDate");
        validateDate(endDate, "endDate");

        const filters = [equalsFilter("campaignId", campaignId)];
        if (adGroupId) filters.push(equalsFilter("adGroupId", adGroupId));
        const resp = await client.post<ReportResponse<SearchTermMetadata>>(
          "/reports/apps/searchterms/query",
          buildV1Report({
            startDate,
            endDate,
            limit: limit ?? 100,
            sortBy: sortBy ?? "localSpend",
            sortOrder: "DESCENDING",
            filters,
            timeZone: "ORTZ",
          })
        );
        const rows = normalizeReportRows<SearchTermMetadata>(resp.data);

        if (rows.length === 0) {
          return { content: [{ type: "text", text: "No search term data found for the specified date range." }] };
        }

        const summaries = rows.map((row) => {
          const meta = row.metadata;
          return [
            `Search Term: "${meta.searchTermText ?? '(unknown)'}"`,
            `Matched Keyword: "${meta.keyword}" (${meta.matchType})`,
            `Source: ${meta.searchTermSource} | Ad Group: ${meta.adGroupName}`,
            formatMetrics(row.total),
          ].join("\n");
        });

        const text = [
          `Search Term Report (${startDate} to ${endDate}):`,
          `Showing ${rows.length} search terms sorted by ${sortBy ?? "localSpend"}`,
          "",
          "💡 Analysis tips:",
          "- High spend + low installs = consider adding as negative keyword",
          "- High installs + low CPA = consider adding as exact match keyword with higher bid",
          "- Search terms not matching your intent = add as negative keywords",
          "",
          ...summaries.map((s, i) => `--- Search Term ${i + 1} ---\n${s}`),
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
