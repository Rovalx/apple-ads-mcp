import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "./client/api-client.js";
const NOT_PORTED = "Apple Ads Platform API v1 does not publish this Campaign Management API v5 resource. Product-page country and device catalogs also have no v1 equivalent.";

const METRICS_GLOSSARY = {
  impressions: {
    definition: "Number of times your ad was shown on the App Store search results page.",
    direction: "higher is better",
    notes: "High impressions with low taps may indicate poor ad relevance or creative quality.",
  },
  taps: {
    definition: "Number of times users tapped on your ad.",
    direction: "higher is better",
    notes: "Taps indicate interest. Compare with impressions to get TTR.",
  },
  ttr: {
    definition: "Tap-through rate. Percentage of impressions that resulted in a tap.",
    formula: "taps / impressions",
    direction: "higher is better",
    benchmarks: "Average ~7-8% for Search Ads. Below 5% may need creative or keyword improvements.",
  },
  totalInstalls: {
    definition: "Total number of app installs (new downloads + redownloads) attributed to the ad.",
    direction: "higher is better",
    notes: "Includes both new users and users who previously deleted the app.",
  },
  totalNewDownloads: {
    definition: "Number of first-time downloads attributed to the ad.",
    direction: "higher is better",
    notes: "Measures true new user acquisition. Excludes redownloads.",
  },
  totalRedownloads: {
    definition: "Number of redownloads by users who previously downloaded the app.",
    direction: "context-dependent",
    notes: "High redownloads may indicate good re-engagement or churn issues.",
  },
  conversionRate: {
    definition: "Percentage of taps that resulted in an install.",
    formula: "totalInstalls / taps",
    direction: "higher is better",
    benchmarks: "Average ~50% for Search Ads. Below 40% may indicate app store listing issues.",
  },
  avgCPA: {
    definition: "Average cost per acquisition (install). The average amount you paid for each install.",
    formula: "localSpend / totalInstalls",
    direction: "lower is better",
    notes: "Primary efficiency metric. Compare against target CPA and customer LTV.",
  },
  avgCPT: {
    definition: "Average cost per tap. The average amount you paid for each tap on your ad.",
    formula: "localSpend / taps",
    direction: "lower is better",
    notes: "Reflects keyword competition level. High CPT with low conversion = expensive waste.",
  },
  localSpend: {
    definition: "Total amount spent in the account's currency during the reporting period.",
    direction: "context-dependent",
    notes: "Evaluate spend relative to budget and the installs/CPA it produced.",
  },
  latOnInstalls: {
    definition: "Installs from users with Limit Ad Tracking enabled (iOS 14+: ATT not granted).",
    direction: "informational",
    notes: "These installs have limited attribution data. High percentage is normal post-iOS 14.5.",
  },
  latOffInstalls: {
    definition: "Installs from users with Limit Ad Tracking disabled (ATT granted).",
    direction: "informational",
    notes: "These installs have full attribution data available.",
  },
  impressionShare: {
    definition: "Percentage of total eligible impressions your ad received in the reporting period.",
    formula: "your impressions / total eligible impressions",
    direction: "higher is better",
    benchmarks: "100% means you won every eligible auction. Below 30% indicates significant missed opportunity.",
    notes: "Available in keyword-level insights. Low share + good CPA = increase bid opportunity.",
  },
  lowImpressionShare: {
    definition: "Percentage of eligible impressions lost due to low bid or rank.",
    direction: "lower is better",
    notes: "High values mean your bid is too low to compete. Consider increasing bids for high-value keywords.",
  },
  rank: {
    definition: "Your ad's average position in search results during the reporting period.",
    direction: "lower is better (1 = top position)",
    notes: "Available in keyword-level insights. Rank 1 typically has best TTR and conversion rate.",
  },
  bidAmount: {
    definition: "The maximum CPT bid you've set for a keyword or ad group.",
    direction: "context-dependent",
    notes: "Higher bids increase impression share but also CPA. Balance against target CPA.",
  },
};

export function registerResources(server: McpServer, client: AppleAdsClient) {
  // Static resource: supported countries and regions
  server.resource(
    "Supported Countries & Regions",
    "apple-ads://countries",
    {
      description: "List of all countries and regions supported by Apple Search Ads. Use these codes for campaign countriesOrRegions and geo targeting. This data rarely changes.",
      mimeType: "application/json",
    },
    async () => {
      return {
        contents: [
          {
            uri: "apple-ads://countries",
            mimeType: "application/json",
            text: JSON.stringify({
              ported: false,
              summary: NOT_PORTED,
              v5Path: "GET /v5/countries-or-regions",
            }, null, 2),
          },
        ],
      };
    }
  );

  // Static resource: app preview device sizes
  server.resource(
    "App Preview Device Sizes",
    "apple-ads://device-sizes",
    {
      description: "Supported device sizes for app preview creatives. Lists all device form factors and their display specifications. This data rarely changes.",
      mimeType: "application/json",
    },
    async () => {
      return {
        contents: [
          {
            uri: "apple-ads://device-sizes",
            mimeType: "application/json",
            text: JSON.stringify({
              ported: false,
              summary: NOT_PORTED,
              v5Path: "GET /v5/creativeappmappings/devices",
            }, null, 2),
          },
        ],
      };
    }
  );

  // Static resource: metrics glossary (no API call)
  server.resource(
    "Apple Search Ads Metrics Glossary",
    "apple-ads://metrics-glossary",
    {
      description: "Definitions, formulas, and interpretation guidance for all Apple Search Ads reporting metrics. Use this to understand what report fields mean and whether higher or lower values are better.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "apple-ads://metrics-glossary",
          mimeType: "application/json",
          text: JSON.stringify({
            summary: `${Object.keys(METRICS_GLOSSARY).length} metric definitions`,
            metrics: METRICS_GLOSSARY,
          }, null, 2),
        },
      ],
    })
  );
}
