import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "../client/api-client.js";
import type { ApiListResponse, ApiResponse, Creative, ProductPage } from "../types/apple-ads.js";
import { formatCreativeSummary } from "../utils/formatters.js";
import { handleToolError } from "../utils/error-handler.js";
import { buildV1Query, equalsFilter } from "../utils/v1.js";

export function registerCreativeTools(server: McpServer, client: AppleAdsClient) {
  server.registerTool("list_creatives", {
    title: "List / Find Creatives",
    description: "List or search creatives in the account. Creatives link product pages to ads — you need a creative before you can create_ad. Filter by adamId to find creatives for a specific app, or use conditions for advanced filtering.",
    inputSchema: {
      limit: z.number().optional().describe("Max results (default 50)"),
      offset: z.number().optional().describe("Pagination offset"),
      adamId: z.number().optional().describe("Filter by app Adam ID"),
      sortBy: z.string().optional().describe("Field to sort by (e.g., 'id', 'name', 'state')"),
      sortOrder: z.enum(["ASCENDING", "DESCENDING"]).optional(),
      conditions: z.array(z.object({
        field: z.string(),
        operator: z.enum(["EQUALS", "GREATER_THAN", "LESS_THAN", "IN", "LIKE", "STARTSWITH", "CONTAINS", "NOT_EQUALS"]),
        values: z.array(z.string()),
      })).optional().describe("Filter conditions"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ limit, offset, adamId, sortBy, sortOrder, conditions }) => {
    try {
      const filters = adamId ? [equalsFilter("adamId", adamId)] : undefined;
      const resp = await client.post<ApiListResponse<Creative>>(
        "/creatives/query",
        buildV1Query({ limit: limit ?? 50, offset, sortBy, sortOrder, conditions, filters })
      );

      const summaries = resp.data.map(formatCreativeSummary);
      const text = [
        `Found ${resp.data.length} creative(s):`,
        "",
        ...summaries.map((s, i) => `--- Creative ${i + 1} ---\n${s}`),
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

  server.registerTool("create_creative", {
    title: "Create Creative",
    description: `Create a new creative for use in ads. Creatives are based on App Store product pages. Use list_product_pages to find available product pages for the app, then provide the productPageId.

After creation, use create_ad to attach the creative to an ad group. Each ad group can have multiple ads with different creatives for A/B testing.`,
    inputSchema: {
      adamId: z.number().describe("App Adam ID"),
      name: z.string().describe("Creative name"),
      productPageId: z.string().optional().describe("Product page ID (use list_product_pages to find)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ adamId, name, productPageId }) => {
    try {
      const body: Record<string, unknown> = {
        name,
        creativeType: productPageId ? "CUSTOM_PRODUCT_PAGE" : "DEFAULT_PRODUCT_PAGE",
        destination: {
          destinationType: "APP_STORE_PRODUCT_PAGE",
          parameters: {
            adamId: String(adamId),
            ...(productPageId ? { productPageId } : {}),
          },
        },
      };

      const resp = await client.post<ApiResponse<Creative>>("/creatives", body);
      return {
        content: [
          { type: "text", text: `Created creative "${resp.data.name}" (ID: ${resp.data.id}). Use create_ad to attach it to an ad group.` },
          { type: "text", text: JSON.stringify(resp.data, null, 2) },
        ],
      };
    } catch (err) {
      return handleToolError(err);
    }
  });

  server.registerTool("get_creative", {
    title: "Get Creative Details",
    description: "Get full details of a specific creative including its associated app, type, state, and timestamps.",
    inputSchema: {
      creativeId: z.number().describe("The creative ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ creativeId }) => {
    try {
      const resp = await client.get<ApiResponse<Creative>>(`/creatives/${creativeId}`);
      const summary = formatCreativeSummary(resp.data);

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(resp.data, null, 2) },
        ],
      };
    } catch (err) {
      return handleToolError(err);
    }
  });

  server.registerTool("get_product_page_by_id", {
    title: "Get Product Page",
    description: "Get details of a specific product page by ID. Product pages are App Store page variations used to create custom creatives. Set includeLocales=true to also fetch locale-specific details (names, descriptions per language).",
    inputSchema: {
      adamId: z.number().describe("App Adam ID"),
      productPageId: z.string().describe("The product page ID"),
      includeLocales: z.boolean().optional().describe("Also fetch locale details (names, descriptions per language)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ adamId, productPageId, includeLocales }) => {
    try {
      const resp = await client.get<ApiResponse<ProductPage>>(`/product-pages/${productPageId}`);
      const pp = resp.data;

      const content: { type: "text"; text: string }[] = [
        { type: "text", text: `Product Page: ${pp.name} (ID: ${pp.id})${pp.isDefault ? " [DEFAULT]" : ""}\nState: ${pp.state}` },
        { type: "text", text: JSON.stringify(resp.data, null, 2) },
      ];

      if (includeLocales) {
        const locales = await client.post<ApiListResponse<Record<string, unknown>>>(
          "/product-pages/locale-details/query",
          buildV1Query({ limit: 100, filters: [equalsFilter("productPageId", productPageId)] })
        );
        content.push(
          { type: "text", text: `\n${locales.data.length} locale(s):` },
          { type: "text", text: JSON.stringify(locales.data, null, 2) },
        );
      }

      return { content };
    } catch (err) {
      return handleToolError(err);
    }
  });

  server.registerTool("list_product_pages", {
    title: "List Product Pages",
    description: "List all product pages for an app. Product pages are App Store page variations that can be used as creatives for custom product page ads. Shows which page is the default and each page's state (VISIBLE, etc.).",
    inputSchema: {
      adamId: z.number().describe("App Adam ID"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ adamId }) => {
    try {
      const resp = await client.post<ApiListResponse<ProductPage>>(
        "/product-pages/query",
        buildV1Query({ limit: 100, filters: [equalsFilter("adamId", adamId)] })
      );

      const text = resp.data
        .map((pp) => `${pp.name} (ID: ${pp.id})${pp.isDefault ? " [DEFAULT]" : ""} — State: ${pp.state}`)
        .join("\n");

      return {
        content: [
          { type: "text", text: `Found ${resp.data.length} product page(s) for app ${adamId}:\n${text}` },
          { type: "text", text: JSON.stringify(resp.data, null, 2) },
        ],
      };
    } catch (err) {
      return handleToolError(err);
    }
  });
}
