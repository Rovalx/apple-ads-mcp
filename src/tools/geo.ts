import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "../client/api-client.js";

import type { ReportResponse } from "../types/reporting.js";
import { formatMetrics } from "../utils/formatters.js";
import { handleToolError } from "../utils/error-handler.js";
import { validateDate } from "../utils/validators.js";
import { buildV1Report, equalsFilter, normalizeReportRows } from "../utils/v1.js";

export function registerGeoTools(server: McpServer, client: AppleAdsClient) {
  server.registerTool("get_geo_performance", {
    title: "Geo Performance Report",
    description: "Get performance metrics broken down by country or region for a campaign. Shows impressions, taps, installs, spend, CPA per market. Use to identify which countries deliver the best ROI and where to increase/decrease investment or adjust geo targeting.",
    inputSchema: {
      campaignId: z.number().describe("The campaign ID"),
      startDate: z.string().describe("Start date (YYYY-MM-DD)"),
      endDate: z.string().describe("End date (YYYY-MM-DD)"),
      granularity: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ campaignId, startDate, endDate, granularity }) => {
    try {
      validateDate(startDate, "startDate");
      validateDate(endDate, "endDate");

      const resp = await client.post<ReportResponse<{ countryOrRegion: string; campaignId: number }>>(
        "/reports/apps/campaigns/query",
        buildV1Report({
          startDate,
          endDate,
          granularity: granularity ?? "DAILY",
          limit: 100,
          sortBy: "localSpend",
          sortOrder: "DESCENDING",
          filters: [equalsFilter("campaignId", campaignId)],
          groupBy: ["countryOrRegion"],
        })
      );

      const rows = normalizeReportRows<{ countryOrRegion: string; campaignId: number }>(resp.data);
      if (rows.length === 0) {
        return { content: [{ type: "text", text: "No geo data found for the specified date range." }] };
      }

      const summaries = rows.map((row) => {
        return [
          `Country/Region: ${row.metadata.countryOrRegion}`,
          formatMetrics(row.total),
        ].join("\n");
      });

      const text = [
        `Geo Performance for Campaign ${campaignId} (${startDate} to ${endDate}):`,
        "",
        ...summaries.map((s, i) => `--- Region ${i + 1} ---\n${s}`),
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
  });
}
