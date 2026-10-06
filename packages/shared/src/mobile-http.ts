/** HTTP errors for account/sync traffic only; model requests use their own policy. */
export class MobileServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryAt?: number,
  ) { super(code); }
}

export class MobileRequestCooldown {
  private error?: MobileServiceError;

  check(): void {
    if (this.error?.retryAt && this.error.retryAt > Date.now()) throw this.error;
    this.error = undefined;
  }

  async read<T>(response: Response): Promise<T> {
    const retry = response.headers.get("Retry-After")?.trim();
    const retryAt = retry
      ? /^\d+(?:\.\d+)?$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)
      : undefined;
    if (response.status === 429 || response.status === 503) {
      const error = new MobileServiceError(response.status === 429 ? "RATE_LIMITED" : "RELAY_UNAVAILABLE", response.status, Number.isFinite(retryAt) ? retryAt : undefined);
      this.error = error;
      await response.body?.cancel();
      throw error;
    }
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new MobileServiceError(response.ok ? "INVALID_RESPONSE" : `HTTP_${response.status}`, response.status); }
    const row = body && typeof body === "object" ? body as Record<string, unknown> : {};
    if (!response.ok || row.success !== true) {
      const error = row.error && typeof row.error === "object" ? row.error as Record<string, unknown> : {};
      throw new MobileServiceError(typeof error.code === "string" ? error.code : `HTTP_${response.status}`, response.status);
    }
    if (!("data" in row)) throw new MobileServiceError("INVALID_RESPONSE", response.status);
    return row.data as T;
  }
}
