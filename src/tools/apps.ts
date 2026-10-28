import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "../client/api-client.js";
import type { ApiListResponse, ApiResponse, AppInfo, AppEligibility, GeoLocation } from "../types/apple-ads.js";
import { handleToolError } from "../utils/error-handler.js";
import { buildV1Query, equalsFilter, inFilter } from "../utils/v1.js";

export function registerAppTools(server: McpServer, client: AppleAdsClient) {
  server.registerTool(
    "search_apps",
    {
      title: "Search Apps",
      description: "Search for apps eligible for Apple Search Ads campaigns by name or keyword. Returns app name, Adam ID (needed for create_campaign), and developer info. Set returnOwnedApps=true to only show apps you own.",
      inputSchema: {
        query: z.string().describe("Search query (app name or keyword)"),
        returnOwnedApps: z.boolean().optional().describe("Only return apps owned by this org (default false)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, returnOwnedApps }) => {
      try {
        const params: Record<string, string> = { query };
        if (returnOwnedApps) params.returnOwnedApps = "true";

        const resp = await client.get<ApiListResponse<AppInfo>>("/search/apps", params);

        const text = resp.data
          .map((app) => `${app.appName} (Adam ID: ${app.adamId}) — ${app.developerName}`)
          .join("\n");

        return {
          content: [
            { type: "text", text: `Found ${resp.data.length} app(s):\n${text}` },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "get_app_eligibility",
    {
      title: "Check App Eligibility",
      description: "Check if an app is eligible for Apple Search Ads in specific countries and supply sources. Shows eligibility state, device class, and minimum age per country. Use before creating a campaign to verify the app can run ads in target markets.",
      inputSchema: {
        adamId: z.number().describe("The app Adam ID"),
        countriesOrRegions: z.array(z.string()).optional().describe("Filter by country/region codes (e.g., ['US', 'GB'])"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ adamId, countriesOrRegions }) => {
      try {
        const filters = [equalsFilter("adamId", adamId)];
        if (countriesOrRegions?.length) filters.push(inFilter("countryOrRegion", countriesOrRegions));
        const resp = await client.post<ApiListResponse<AppEligibility>>(
          "/eligibilities/apps/query",
          buildV1Query({ limit: 100, filters })
        );

        if (resp.data.length === 0) {
          return { content: [{ type: "text", text: `No eligibility data found for Adam ID ${adamId}.` }] };
        }

        const lines = resp.data.map((item) => {
          return [
            `Adam ID: ${item.adamId}`,
            `Country/Region: ${item.countryOrRegion}`,
            `Supply Source: ${item.supplySource}`,
            `Device Class: ${item.deviceClass}`,
            `State: ${item.state}`,
            `Min Age: ${item.minAge}`,
          ].join("\n");
        });

        return {
          content: [
            { type: "text", text: lines.join("\n---\n") },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "get_app_details",
    {
      title: "Get App Details",
      description: "Get detailed information about an app by Adam ID including app name, category, and store metadata. Set includeLocales=true to also fetch localized names and descriptions per language/region.",
      inputSchema: {
        adamId: z.number().describe("The app Adam ID"),
        includeLocales: z.boolean().optional().describe("Also fetch localized names/descriptions per locale"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ adamId, includeLocales }) => {
      try {
        const resp = await client.get<ApiResponse<Record<string, unknown>>>(`/apps/${adamId}`);

        const content: { type: "text"; text: string }[] = [
          { type: "text", text: `App details for Adam ID ${adamId}:` },
          { type: "text", text: JSON.stringify(resp.data, null, 2) },
        ];

        if (includeLocales) {
          const locales = await client.post<ApiListResponse<Record<string, unknown>>>(
            `/apps/${adamId}/locale-details/query`,
            buildV1Query({ limit: 100 })
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
    }
  );

  server.registerTool(
    "find_app_assets",
    {
      title: "Find App Assets",
      description: "Find app assets (screenshots, app previews, etc.) using filters. Useful for checking which visual assets are available before creating creatives. Filter by device class, orientation, or asset type using conditions.",
      inputSchema: {
        adamId: z.number().describe("The app Adam ID"),
        limit: z.number().optional().describe("Max results (default 1000)"),
        offset: z.number().optional().describe("Pagination offset"),
        sortBy: z.string().optional().describe("Field to sort by"),
        sortOrder: z.enum(["ASCENDING", "DESCENDING"]).optional(),
        conditions: z.array(z.object({
          field: z.string(),
          operator: z.enum(["EQUALS", "GREATER_THAN", "LESS_THAN", "IN", "LIKE", "STARTSWITH", "CONTAINS", "NOT_EQUALS"]),
          values: z.array(z.string()),
        })).optional().describe("Filter conditions"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ adamId, limit, offset, sortBy, sortOrder, conditions }) => {
      try {
        const resp = await client.post<ApiListResponse<Record<string, unknown>>>(
          "/assets/query",
          buildV1Query({
            limit: limit ?? 1000,
            offset,
            sortBy,
            sortOrder,
            conditions,
            filters: [equalsFilter("adamId", adamId)],
          })
        );

        return {
          content: [
            { type: "text", text: `Found ${resp.data.length} asset(s) for app ${adamId}.` },
            { type: "text", text: JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  // get_supported_countries_regions is now a Resource (apple-ads://countries)

  server.registerTool(
    "search_geolocations",
    {
      title: "Search / Lookup Geo Locations",
      description: "Not available on Apple Ads Platform API v1. Campaign Management API v5 GET/POST /search/geo has no published equivalent. The preview notes that geolocation targeting ids will be documented later, and product-page country/device lists also have no v1 replacement. Params are kept so existing clients get a clear error instead of a v5 call.",
      inputSchema: {
        query: z.string().optional().describe("Search query (e.g., 'New York', 'United Kingdom')"),
        entity: z.string().optional().describe("Entity type filter: Country, AdminArea, Locality"),
        countryCode: z.string().optional().describe("Filter by country code (e.g., 'US')"),
        geoIds: z.array(z.string()).optional().describe("Array of geo location IDs to look up (alternative to query)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      return {
        content: [{
          type: "text",
          text: "search_geolocations cannot be ported. Apple Ads Platform API v1 does not publish the Campaign Management API v5 /search/geo endpoint. Product-page country and device lookups also have no v1 equivalent. Geo targeting id lookup was marked as coming later in Apple's July 2026 preview.",
        }],
        isError: true,
      };
    }
  );
}
