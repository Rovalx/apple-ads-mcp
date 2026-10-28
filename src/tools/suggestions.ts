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
      description: "Keyword suggestions with Apple's popularity score (0-100) for an App Store app. Calls POST /v1/suggestions/keywords/query. Requires an ad account context. promotedObjectId is the app adamId; promotedObjectType is APPSTORE_APP. Pass countriesOrRegions (for example ['PL']) to scope storefronts. The API rejects sorting by popularity, so this tool omits sorting and orders the page by popularity descending after the response. Seed terms (terms) make scores relative to those seeds and can return mixed languages: a PL query seeded with 'gry imprezowe' dropped a term from popularity 50 to 5, and a US query returned DE/ES/IT terms. Omit terms for absolute storefront scores. This is discovery data, not your campaign's search-term report.",
      inputSchema: {
        adamId: z.number().describe("App Adam ID (sent as promotedObjectId)"),
        countriesOrRegions: z.array(z.string()).optional().describe("Storefront codes, e.g. ['PL']"),
        terms: z.array(z.string()).optional().describe("Optional seed terms. Scores become relative and results can mix languages. Omit for absolute popularity."),
        limit: z.number().optional().describe("Page size (default 500)"),
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
            ...buildV1Query({ limit: limit ?? 500 }),
            filters,
          }
        );
        const rows = asList<KeywordSuggestion>(resp.data).sort(
          (a, b) => (b.popularity ?? -1) - (a.popularity ?? -1)
        );
        const seedNote = terms?.length
          ? " Scores are relative to the seed terms and may mix languages."
          : "";
        const text = rows.length
          ? rows.map((row, i) => `${i + 1}. "${row.text ?? ""}" — popularity ${row.popularity ?? "n/a"}`).join("\n")
          : "No keyword suggestions returned.";
        return {
          content: [
            { type: "text", text: `Keyword suggestions for adamId ${adamId}${countriesOrRegions?.length ? ` in ${countriesOrRegions.join(", ")}` : ""}:${seedNote}\n${text}` },
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
      description: "App Store search-term popularity for a country and optional genre. Calls POST /v1/insights/apps/search-term-popularity/query. This is market demand (rank and popularity), not the queries that triggered your ads — use get_search_term_report for that. Granularity is WEEKLY_SUN_SAT or MONTHLY. Genre examples: GAMES, PRODUCTIVITY. Apple only returns roughly the top 500 terms per genre. Optional searchTerms uses filter field searchTerm with operator IN. CONTAINS returns nothing on this endpoint.",
      inputSchema: {
        countryOrRegion: z.string().describe("Storefront code, e.g. 'PL' or 'US'"),
        genre: z.string().optional().describe("App Store genre, e.g. 'GAMES' or 'PRODUCTIVITY'. Omit to leave the genre filter off."),
        searchTerms: z.array(z.string()).optional().describe("Exact terms to include (filter field searchTerm, operator IN)"),
        startDate: z.string().describe("Range start (YYYY-MM-DD)"),
        endDate: z.string().describe("Range end (YYYY-MM-DD)"),
        granularity: z.enum(["WEEKLY_SUN_SAT", "MONTHLY"]).optional().describe("Default WEEKLY_SUN_SAT"),
        limit: z.number().optional().describe("Page size (default 500, about the size of Apple's per-genre list)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ countryOrRegion, genre, searchTerms, startDate, endDate, granularity, limit }) => {
      try {
        validateDate(startDate, "startDate");
        validateDate(endDate, "endDate");
        const filters: V1Filter[] = [equalsFilter("countryOrRegion", countryOrRegion)];
        if (genre) filters.push(equalsFilter("genre", genre));
        if (searchTerms?.length) filters.push(inFilter("searchTerm", searchTerms));
        const body = {
          filters,
          timeRange: {
            start: startDate,
            end: endDate,
            granularity: granularity ?? "WEEKLY_SUN_SAT",
          },
          sorting: [{ field: "rankInGenre", order: "ASC" as const }],
          pagination: { offset: 0, pageSize: limit ?? 500, fetchTotalCount: true },
        };
        const resp = await client.post<{ data: unknown }>("/insights/apps/search-term-popularity/query", body);
        const rows = asList<PopularityRow>(resp.data);
        const text = rows.length
          ? rows.map((row) =>
              `#${row.rankInGenre ?? "?"} "${row.searchTerm ?? ""}" — popularity ${row.searchPopularity1to100 ?? row.searchPopularityInGenre ?? "n/a"} (1-5: ${row.searchPopularity1to5 ?? "n/a"})`
            ).join("\n")
          : "No search-term popularity rows returned.";
        const scope = genre ? `${genre} in ${countryOrRegion}` : countryOrRegion;
        return {
          content: [
            { type: "text", text: `Search term popularity for ${scope} (about the top 500 terms per genre):\n${text}` },
            { type: "text", text: JSON.stringify(rows, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
