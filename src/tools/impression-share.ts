import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "../client/api-client.js";
import { handleToolError } from "../utils/error-handler.js";
import { validateDate } from "../utils/validators.js";
import { asList, equalsFilter } from "../utils/v1.js";

export function registerImpressionShareTools(server: McpServer, client: AppleAdsClient) {
  server.registerTool("create_impression_share_report", {
    title: "Create Custom Impression Share Report",
    description: "Query impression share synchronously via POST /v1/insights/apps/impression-share/query. v5 async custom reports (create, then poll by id) have no v1 equivalent. Requires adamId (promotedObjectId). name is kept and only used as a label. DAILY stays DAILY; WEEKLY is sent as WEEKLY_SUN_SAT. MONTHLY is not supported.",
    inputSchema: {
      name: z.string().describe("Label for the response. Not sent to Apple; v1 has no named custom report."),
      startTime: z.string().describe("Start date (YYYY-MM-DD)"),
      endTime: z.string().describe("End date (YYYY-MM-DD)"),
      granularity: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional().describe("DAILY or WEEKLY (sent as WEEKLY_SUN_SAT). MONTHLY is rejected."),
      adamId: z.number().optional().describe("App Adam ID. Required by v1 as promotedObjectId."),
      reportType: z.enum(["ALL_SLOTS", "FIRST_SLOT"]).optional().describe("Default ALL_SLOTS"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ name, startTime, endTime, granularity, adamId, reportType }) => {
    try {
      validateDate(startTime, "startTime");
      validateDate(endTime, "endTime");
      if (!adamId) {
        return { content: [{ type: "text", text: "Platform API v1 impression share requires adamId (promotedObjectId). The v5 custom-report id workflow is gone." }], isError: true };
      }
      if (granularity === "MONTHLY") {
        return { content: [{ type: "text", text: "Platform API v1 impression share supports DAILY and WEEKLY_SUN_SAT, not MONTHLY." }], isError: true };
      }
      const body = {
        filters: [equalsFilter("promotedObjectId", String(adamId))],
        options: { impressionShareReportType: reportType ?? "ALL_SLOTS" },
        timeRange: {
          start: startTime,
          end: endTime,
          granularity: granularity === "WEEKLY" ? "WEEKLY_SUN_SAT" : "DAILY",
        },
        pagination: { offset: 0, pageSize: 100, fetchTotalCount: true },
      };
      const resp = await client.post<{ data: unknown }>("/insights/apps/impression-share/query", body);
      const rows = asList<unknown>(resp.data);
      return {
        content: [
          { type: "text", text: `Impression share "${name}" for adamId ${adamId}: ${rows.length} row(s). This call is synchronous; there is no report id to poll.` },
          { type: "text", text: JSON.stringify(resp.data, null, 2) },
        ],
      };
    } catch (err) {
      return handleToolError(err);
    }
  });

  server.registerTool("get_impression_share_report_by_id", {
    title: "Get Impression Share Report",
    description: "Not available on Platform API v1. Custom impression-share reports are no longer stored resources you fetch by id. Use create_impression_share_report, which queries POST /v1/insights/apps/impression-share/query synchronously.",
    inputSchema: {
      reportId: z.number().describe("The report ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ reportId }) => {
    return {
      content: [{
        type: "text",
        text: `get_impression_share_report_by_id cannot be ported. Platform API v1 has no custom report ${reportId}. Impression share is a synchronous query: call create_impression_share_report with adamId, startTime, and endTime.`,
      }],
      isError: true,
    };
  });

  server.registerTool("list_impression_share_reports", {
    title: "List Impression Share Reports",
    description: "Not available on Platform API v1. There is no list of stored custom impression-share reports. Query impression share with create_impression_share_report.",
    inputSchema: {
      limit: z.number().optional().describe("Max results (default 50)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    return {
      content: [{
        type: "text",
        text: "list_impression_share_reports cannot be ported. Platform API v1 does not keep custom impression-share report ids. Call create_impression_share_report with an adamId.",
      }],
      isError: true,
    };
  });
}
