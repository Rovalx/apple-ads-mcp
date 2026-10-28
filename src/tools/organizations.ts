import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleAdsClient } from "../client/api-client.js";
import type { ApiResponse, MeDetail } from "../types/apple-ads.js";
import { loadState, saveState } from "../state.js";
import { handleToolError } from "../utils/error-handler.js";

interface V1AclEntry {
  adAccount?: { id?: number | string; name?: string; orgId?: number | string };
  roles?: string[];
  orgId?: number | string;
  orgName?: string;
  currency?: string;
  roleNames?: string[];
}

export function registerOrganizationTools(server: McpServer, client: AppleAdsClient) {
  server.registerTool(
    "list_ad_accounts",
    {
      title: "List Ad Accounts",
      description: "List ad accounts this API user can access (GET /v1/acls). Each row has an adAccount.id and a parent orgId. They are different identifiers. Platform API v1 sends X-AP-Context: adAccountId=... and will not accept an organization id in that header. Call switch_ad_account with adAccount.id, or set ASA_AD_ACCOUNT_ID. This call does not require an ad account to already be selected.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return await renderAcls(client);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "list_organizations",
    {
      title: "List Organizations",
      description: "v5 name kept for compatibility. On Platform API v1 this calls GET /v1/acls and lists accessible ad accounts together with each account's parent orgId. Do not pass the org id to switch_ad_account. Use list_ad_accounts for the same data.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return await renderAcls(client);
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "get_me_details",
    {
      title: "Get Current User",
      description: "Get the authenticated API user (GET /v1/me). orgId here is the parent organization, not the ad account used as X-AP-Context. Does not require an ad account to be selected.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const resp = await client.get<ApiResponse<MeDetail>>("/me", undefined, { skipAccountHeader: true });
        const me = resp.data;
        const parentOrg = me.orgId ?? me.parentOrgId;
        return {
          content: [
            { type: "text", text: `User ID: ${me.userId}\nParent org ID: ${parentOrg ?? "N/A"}\nThis org id is not the ad account id.` },
            { type: "text", text: JSON.stringify(me, null, 2) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "switch_ad_account",
    {
      title: "Switch Ad Account",
      description: "Select the ad account used as X-AP-Context: adAccountId=... for later calls. Pass adAccount.id from list_ad_accounts. Do not pass an organization id. The choice is saved and reused until ASA_AD_ACCOUNT_ID overrides it or you switch again.",
      inputSchema: {
        adAccountId: z.string().describe("Ad account id (adAccount.id from list_ad_accounts). Not an org id."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ adAccountId }) => {
      try {
        client.setAdAccountId(adAccountId);
        saveState({ ...loadState(), adAccountId });
        return {
          content: [
            { type: "text", text: `Selected ad account ${adAccountId}. Later API calls send X-AP-Context: adAccountId=${adAccountId}.` },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );

  server.registerTool(
    "switch_organization",
    {
      title: "Switch Organization",
      description: "Records an organization id but does not change the Platform API v1 request context. v1 calls are scoped by ad account id, which is not the same as org id. Use switch_ad_account.",
      inputSchema: {
        orgId: z.string().describe("Parent organization id. This is not sent as X-AP-Context."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ orgId }) => {
      try {
        saveState({ ...loadState(), orgId });
        return {
          content: [
            {
              type: "text",
              text: `Saved organization ${orgId}. Platform API v1 does not use this value as the request context. Call list_ad_accounts and switch_ad_account with adAccount.id (or set ASA_AD_ACCOUNT_ID).`,
            },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}

async function renderAcls(client: AppleAdsClient) {
  const resp = await client.get<{ data?: { acls?: V1AclEntry[] } | V1AclEntry[] }>("/acls", undefined, { skipAccountHeader: true });
  const raw = resp.data;
  const entries: V1AclEntry[] = Array.isArray(raw) ? raw : raw?.acls ?? [];
  const active = client.getAdAccountId();

  const lines = entries.map((entry) => {
    const account = entry.adAccount;
    const adAccountId = account?.id != null ? String(account.id) : undefined;
    const orgId = account?.orgId ?? entry.orgId;
    const name = account?.name ?? entry.orgName ?? "Unnamed";
    const roles = entry.roles ?? entry.roleNames;
    const marker = adAccountId && adAccountId === active ? " [ACTIVE AD ACCOUNT]" : "";
    return [
      `${name}${marker}`,
      adAccountId ? `  Ad account id: ${adAccountId}` : "  Ad account id: n/a",
      orgId != null ? `  Parent org id: ${orgId} (not the request context)` : null,
      entry.currency ? `  Currency: ${entry.currency}` : null,
      `  Roles: ${roles?.join(", ") ?? "N/A"}`,
    ].filter(Boolean).join("\n");
  });

  const text = [
    `Found ${entries.length} ad account(s) via GET /v1/acls.`,
    active ? `Currently selected ad account: ${active}` : "No ad account selected. Use switch_ad_account with an ad account id, not the parent org id.",
    "",
    ...lines,
  ].join("\n");

  return {
    content: [
      { type: "text" as const, text },
      { type: "text" as const, text: JSON.stringify(entries, null, 2) },
    ],
  };
}
