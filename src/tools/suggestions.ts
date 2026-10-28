import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "../client/api-client.js";
import { handleToolError } from "../utils/error-handler.js";
import { validateDate } from "../utils/validators.js";
import { asList, buildV1Query, equalsFilter, inFilter, type V1Filter } from "../utils/v1.js";

interface KeywordSuggestion {
  text?: string;
  popularity?: number;
}

interface PopularityRow {
  week?: string;
  countryOrRegion?: string;
  genre?: string;
  searchTerm?: string;
  rankInGenre?: number;
  searchPopularityInGenre?: number;
  searchPopularity1to100?: number;
  searchPopularity1to5?: number;
}

export function registerSuggestionTools(server: McpServer, client: AppleAdsClient) {
  server.registerTool(
    "get_keyword_suggestions",
    {
      title: "Keyword Suggestions",
      description: "Keyword suggestions with Apple's popularity score (0-100) for an App Store app. Calls POST /v1/suggestions/keywords/query. Requires an ad account context. promotedObjectId is the app adamId; promotedObjectType is APPSTORE_APP. Pass countriesOrRegions (for example ['PL']) to scope storefronts, and optional seed terms. Results are sorted by popularity descending. This is discovery data, not your campaign's search-term report.",
      inputSchema: {
        adamId: z.number().describe("App Adam ID (sent as promotedObjectId)"),
        countriesOrRegions: z.array(z.string()).optional().describe("Storefront codes, e.g. ['PL']"),
        terms: z.array(z.string()).optional().describe("Optional seed terms"),
        limit: z.number().optional().describe("Page size (default 20)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ adamId, countriesOrRegions, terms, limit }) => {
      try {
        const filters: V1Filter[] = [
          { field: "promotedObjectId", operator: "EQUALS", value: [String(adamId)] },
          { field: "promotedObjectType", operator: "EQUALS", value: ["APPSTORE_APP"] },
        ];
        if (countriesOrRegions?.length) filters.push(inFilter("countriesOrRegions", countriesOrRegions));
        if (terms?.length) filters.push(inFilter("terms", terms));

        const resp = await client.post<{ data: unknown }>(
          "/suggestions/keywords/query",
          {
            ...buildV1Query({ limit: limit ?? 20, sortBy: "popularity", sortOrder: "DESCENDING" }),
            filters,
          }
        );
        const rows = asList<KeywordSuggestion>(resp.data);
        const text = rows.length
          ? rows.map((row, i) => `${i + 1}. "${row.text ?? ""}" — popularity ${row.popularity ?? "n/a"}`).join("\n")
          : "No keyword suggestions returned.";
        return {
          content: [
            { type: "text", text: `Keyword suggestions for adamId ${adamId}${countriesOrRegions?.length ? ` in ${countriesOrRegions.join(", ")}` : ""}:\n${text}` },
            { type: "text", text: JSON.stringify(rows, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "get_search_term_popularity",
    {
      title: "Search Term Popularity",
      description: "App Store search-term popularity for a country and genre. Calls POST /v1/insights/apps/search-term-popularity/query. This is market demand (rank and popularity), not the queries that triggered your ads — use get_search_term_report for that. Granularity is WEEKLY_SUN_SAT or MONTHLY. Genre examples from Apple include PRODUCTIVITY.",
      inputSchema: {
        countryOrRegion: z.string().describe("Storefront code, e.g. 'PL' or 'US'"),
        genre: z.string().describe("App Store genre, e.g. 'PRODUCTIVITY'"),
        startDate: z.string().describe("Range start (YYYY-MM-DD)"),
        endDate: z.string().describe("Range end (YYYY-MM-DD)"),
        granularity: z.enum(["WEEKLY_SUN_SAT", "MONTHLY"]).optional().describe("Default WEEKLY_SUN_SAT"),
        limit: z.number().optional().describe("Page size (default 20)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ countryOrRegion, genre, startDate, endDate, granularity, limit }) => {
      try {
        validateDate(startDate, "startDate");
        validateDate(endDate, "endDate");
        const body = {
          filters: [
            equalsFilter("countryOrRegion", countryOrRegion),
            equalsFilter("genre", genre),
          ],
          timeRange: {
            start: startDate,
            end: endDate,
            granularity: granularity ?? "WEEKLY_SUN_SAT",
          },
          sorting: [{ field: "rankInGenre", order: "ASC" as const }],
          pagination: { offset: 0, pageSize: limit ?? 20 },
        };
        const resp = await client.post<{ data: unknown }>("/insights/apps/search-term-popularity/query", body);
        const rows = asList<PopularityRow>(resp.data);
        const text = rows.length
          ? rows.map((row) =>
              `#${row.rankInGenre ?? "?"} "${row.searchTerm ?? ""}" — popularity ${row.searchPopularity1to100 ?? row.searchPopularityInGenre ?? "n/a"} (1-5: ${row.searchPopularity1to5 ?? "n/a"})`
            ).join("\n")
          : "No search-term popularity rows returned.";
        return {
          content: [
            { type: "text", text: `Search term popularity for ${genre} in ${countryOrRegion}:\n${text}` },
            { type: "text", text: JSON.stringify(rows, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
