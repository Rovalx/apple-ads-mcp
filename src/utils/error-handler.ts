import { AppleAdsApiError } from "../client/api-client.js";

export function handleToolError(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return {
      content: [{ type: "text", text: "Request timed out after 30s. The Apple Ads API may be slow — try again." }],
      isError: true,
    };
  }

  if (err instanceof AppleAdsApiError) {
    const hint = err.status === 401 ? "Check your API credentials."
      : err.status === 403 ? "Check ad account permissions. The X-AP-Context ad account id is not an organization id."
      : err.status === 404 ? "The resource was not found. Verify the ID is correct."
      : err.status === 429 ? "Rate limited. Try again in a moment."
      : "";
    return {
      content: [{ type: "text", text: `API Error (${err.status}): ${err.body}${hint ? `\n${hint}` : ""}` }],
      isError: true,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
