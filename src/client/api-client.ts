import type { Config } from "../config.js";
import { getAccessToken } from "../auth/oauth.js";

const BASE_URL = "https://api.ads.apple.com/v1";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

export class AppleAdsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`Apple Ads API error: ${method} ${path} returned ${status}: ${body}`);
  }
}

export interface RequestOptions {
  /** /me and /acls are not scoped to an ad account. */
  skipAccountHeader?: boolean;
  /** @deprecated Use skipAccountHeader. Kept so older call sites still compile. */
  skipOrgHeader?: boolean;
}

export class AppleAdsClient {
  private adAccountId: string | undefined;

  constructor(private config: Config) {
    this.adAccountId = config.adAccountId;
  }

  getAdAccountId(): string | undefined {
    return this.adAccountId;
  }

  setAdAccountId(adAccountId: string): void {
    this.adAccountId = adAccountId;
  }

  private requireAdAccountId(): string {
    if (!this.adAccountId) {
      throw new Error(
        "No ad account selected. An organization id is not an ad account id. Call list_ad_accounts, then switch_ad_account, or set ASA_AD_ACCOUNT_ID."
      );
    }
    return this.adAccountId;
  }

  async get<T>(path: string, params?: Record<string, string>, options?: RequestOptions): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    return this.request<T>("GET", url.toString(), undefined, 1, options);
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", `${BASE_URL}${path}`, body, 1, options);
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", `${BASE_URL}${path}`, body, 1, options);
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", `${BASE_URL}${path}`, undefined, 1, options);
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
    attempt = 1,
    options?: RequestOptions,
  ): Promise<T> {
    const token = await getAccessToken(this.config);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const skipAccount = options?.skipAccountHeader || options?.skipOrgHeader;
    if (!skipAccount) {
      headers["X-AP-Context"] = `adAccountId=${this.requireAdAccountId()}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 429 || (response.status >= 500 && attempt < MAX_RETRIES)) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.error(
        `[api] ${method} ${url} returned ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
      );
      await sleep(delay);
      return this.request<T>(method, url, body, attempt + 1, options);
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return {} as T;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new AppleAdsApiError(response.status, method, url, text);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return normalizeV1<T>(await response.json());
    }
    return (await response.text()) as unknown as T;
  }
}

/** Platform API responses use `result` where Campaign Management API v5 used `data`. */
export function normalizeV1<T>(body: unknown): T {
  if (!body || typeof body !== "object") return body as T;
  const obj = body as Record<string, unknown>;
  if ("result" in obj && !("data" in obj)) {
    obj.data = obj.result;
  }
  if (obj.pagination && typeof obj.pagination === "object") {
    const pagination = obj.pagination as Record<string, unknown>;
    if (pagination.totalCount != null && pagination.totalResults == null) {
      pagination.totalResults = pagination.totalCount;
    }
    if (pagination.pageSize != null && pagination.itemsPerPage == null) {
      pagination.itemsPerPage = pagination.pageSize;
    }
    if (pagination.offset != null && pagination.startIndex == null) {
      pagination.startIndex = pagination.offset;
    }
  }
  return obj as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
