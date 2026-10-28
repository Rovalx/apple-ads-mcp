import { readFileSync } from "fs";
import { resolve } from "path";
import { loadState } from "./state.js";

export interface Config {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
  /**
   * Platform API v1 request context. Not the same value as an organization id.
   * Comes from ASA_AD_ACCOUNT_ID or a previous switch_ad_account.
   */
  adAccountId?: string;
  /** Kept for callers that still set ASA_ORG_ID. Never sent as X-AP-Context. */
  orgId?: string;
}

export function loadConfig(): Config {
  const clientId = requireEnv("ASA_CLIENT_ID");
  const teamId = requireEnv("ASA_TEAM_ID");
  const keyId = requireEnv("ASA_KEY_ID");
  const state = loadState();
  const adAccountId = process.env.ASA_AD_ACCOUNT_ID || state.adAccountId || undefined;
  const orgId = process.env.ASA_ORG_ID || state.orgId || undefined;

  const inlineKey = process.env.ASA_PRIVATE_KEY;
  const keyPath = process.env.ASA_PRIVATE_KEY_PATH;

  let privateKey: string;
  if (inlineKey) {
    privateKey = inlineKey.replace(/\\n/g, "\n");
  } else if (keyPath) {
    const resolvedPath = resolve(keyPath);
    try {
      privateKey = readFileSync(resolvedPath, "utf-8");
    } catch (err) {
      throw new Error(
        `Failed to read private key at ${resolvedPath}: ${err instanceof Error ? err.message : err}`
      );
    }
  } else {
    throw new Error(
      "Set ASA_PRIVATE_KEY (PEM content) or ASA_PRIVATE_KEY_PATH (file path)"
    );
  }

  return { clientId, teamId, keyId, privateKey, adAccountId, orgId };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
