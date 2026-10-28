import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "../client/api-client.js";
import type { ApiListResponse, ApiResponse, BudgetOrder } from "../types/apple-ads.js";
import { buildV1Query, money } from "../utils/v1.js";
import { formatBudgetOrderSummary } from "../utils/formatters.js";
import { toISO8601 } from "../utils/date-helpers.js";
import { handleToolError } from "../utils/error-handler.js";
import { validateDate } from "../utils/validators.js";

export function registerBudgetOrderTools(server: McpServer, client: AppleAdsClient) {
  server.registerTool("list_budget_orders", {
    title: "List Budget Orders",
    description: "List all budget orders in the account. Budget orders define the overall spending authorization and billing relationship. Shows order name, budget, status (ACTIVE/INACTIVE/EXHAUSTED), and date range.",
    inputSchema: {
      limit: z.number().optional().describe("Max results to return (default 50)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ limit, offset }) => {
    try {
      const resp = await client.post<ApiListResponse<BudgetOrder>>(
        "/shared-budgets/query",
        buildV1Query({ limit: limit ?? 50, offset })
      );

      const summaries = resp.data.map(formatBudgetOrderSummary);
      const text = [
        `Found ${resp.data.length} budget order(s):`,
        "",
        ...summaries.map((s, i) => `--- Budget Order ${i + 1} ---\n${s}`),
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
  });

  server.registerTool("get_budget_order", {
    title: "Get Budget Order",
    description: "Get full details of a specific budget order including budget amount, remaining balance, supply sources, and billing contacts.",
    inputSchema: {
      budgetOrderId: z.number().describe("The budget order ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ budgetOrderId }) => {
    try {
      const resp = await client.get<ApiResponse<BudgetOrder>>(`/shared-budgets/${budgetOrderId}`);
      return {
        content: [
          { type: "text", text: formatBudgetOrderSummary(resp.data) },
          { type: "text", text: JSON.stringify(resp.data, null, 2) },
        ],
      };
    } catch (err) {
      return handleToolError(err);
    }
  });

  server.registerTool("create_budget_order", {
    title: "Create Budget Order",
    description: "Create a new budget order to authorize spending. Budget orders are the top-level billing entity — campaigns draw from them. Requires name, budget amount, and start date. The budget order must be approved before campaigns can spend against it.",
    inputSchema: {
      name: z.string().describe("Budget order name"),
      budgetAmount: z.string().describe("Budget amount (e.g., '10000.00')"),
      currency: z.string().optional().describe("Currency code (default 'USD')"),
      startDate: z.string().describe("Start date (YYYY-MM-DD)"),
      endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
      supplySources: z.array(z.string()).optional().describe("Supply sources"),
      orderNumber: z.string().optional().describe("Order number identifier"),
      clientName: z.string().optional().describe("Client name"),
      primaryBuyerName: z.string().optional().describe("Primary buyer name"),
      primaryBuyerEmail: z.string().optional().describe("Primary buyer email"),
      billingEmail: z.string().optional().describe("Billing email address"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ name, budgetAmount, currency, startDate, endDate, supplySources, orderNumber, clientName, primaryBuyerName, primaryBuyerEmail, billingEmail }) => {
    try {
      validateDate(startDate, "startDate");
      if (endDate) validateDate(endDate, "endDate");

      const adAccountId = client.getAdAccountId();
      const body: Record<string, unknown> = {
        name,
        startTime: toISO8601(startDate),
        value: money(budgetAmount, currency ?? "USD"),
        ...(adAccountId ? { adAccountIds: [Number(adAccountId)] } : {}),
      };
      if (endDate) body.endTime = toISO8601(endDate);
      if (primaryBuyerName || primaryBuyerEmail || billingEmail) {
        body.invoiceDetail = { primaryBuyerName, primaryBuyerEmail, billingEmail };
      }
      const ignored = [supplySources && "supplySources", orderNumber && "orderNumber", clientName && "clientName"]
        .filter(Boolean)
        .join(", ");

      const resp = await client.post<ApiResponse<BudgetOrder>>("/shared-budgets", body);
      return {
        content: [
          { type: "text", text: `Created shared budget "${resp.data.name}" (ID: ${resp.data.id}).${ignored ? ` Ignored v5-only fields: ${ignored}.` : ""} Assign it with update_campaign is not automatic; v1 uses sharedBudgets on the campaign.` },
          { type: "text", text: JSON.stringify(resp.data, null, 2) },
        ],
      };
    } catch (err) {
      return handleToolError(err);
    }
  });

  server.registerTool("update_budget_order", {
    title: "Update Budget Order",
    description: "Update an existing budget order. Can change name, budget amount, and end date. Increasing budget extends spending capacity; decreasing it may cause campaigns to pause if they've exceeded the new limit.",
    inputSchema: {
      budgetOrderId: z.number().describe("The budget order ID"),
      name: z.string().optional().describe("New name"),
      budgetAmount: z.string().optional().describe("New budget amount"),
      currency: z.string().optional().describe("Currency code (default 'USD')"),
      endDate: z.string().optional().describe("New end date (YYYY-MM-DD)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ budgetOrderId, name, budgetAmount, currency, endDate }) => {
    try {
      if (endDate) validateDate(endDate, "endDate");

      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (budgetAmount) body.value = money(budgetAmount, currency ?? "USD");
      if (endDate) body.endTime = toISO8601(endDate);

      if (Object.keys(body).length === 0) {
        return { content: [{ type: "text", text: "No changes specified." }] };
      }

      const resp = await client.put<ApiResponse<BudgetOrder>>(`/shared-budgets/${budgetOrderId}`, body);
      return {
        content: [
          { type: "text", text: `Updated budget order "${resp.data.name}" (ID: ${resp.data.id})` },
          { type: "text", text: JSON.stringify(resp.data, null, 2) },
        ],
      };
    } catch (err) {
      return handleToolError(err);
    }
  });
}
