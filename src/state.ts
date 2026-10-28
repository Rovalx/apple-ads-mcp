import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STATE_DIR = join(homedir(), ".apple-ads-mcp");
const STATE_FILE = join(STATE_DIR, "state.json");

interface State {
  orgId?: string;
  adAccountId?: string;
}

export function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveState(state: State): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[state] Failed to save state:", err);
  }
}
