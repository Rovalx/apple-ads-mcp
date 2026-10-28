#!/usr/bin/env node
import { createRequire } from "module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
import { AppleAdsClient } from "./client/api-client.js";
import { registerCampaignTools } from "./tools/campaigns.js";
import { registerAdGroupTools } from "./tools/adgroups.js";
import { registerKeywordTools } from "./tools/keywords.js";
import { registerSearchTermTools } from "./tools/search-terms.js";
import { registerOptimizationTools } from "./tools/optimization.js";
import { registerGeoTools } from "./tools/geo.js";
import { registerAppTools } from "./tools/apps.js";
import { registerBudgetOrderTools } from "./tools/budget-orders.js";
import { registerAdTools } from "./tools/ads.js";
import { registerCreativeTools } from "./tools/creatives.js";
import { registerOrganizationTools } from "./tools/organizations.js";
import { registerImpressionShareTools } from "./tools/impression-share.js";
import { registerSuggestionTools } from "./tools/suggestions.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

async function main() {
  const config = loadConfig();
  const client = new AppleAdsClient(config);

  const server = new McpServer({
    name: "apple-ads",
    version,
  });

  // Register resources (static/slow-changing data)
  registerResources(server, client);

  // Register prompts (workflow templates)
  registerPrompts(server);

  // Register all tools
  registerOrganizationTools(server, client);
  registerCampaignTools(server, client);
  registerAdGroupTools(server, client);
  registerKeywordTools(server, client);
  registerSearchTermTools(server, client);
  registerOptimizationTools(server, client);
  registerGeoTools(server, client);
  registerAppTools(server, client);
  registerBudgetOrderTools(server, client);
  registerAdTools(server, client);
  registerCreativeTools(server, client);
  registerImpressionShareTools(server, client);
  registerSuggestionTools(server, client);

  // Start STDIO transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[apple-ads-mcp] Server started with STDIO transport");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
