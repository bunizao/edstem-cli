export class BrowserSession {
  private readonly cookies = new Map<string, string>();

  async fetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = this.cookieHeader();
    if (cookie && !headers.has("Cookie")) {
      headers.set("Cookie", cookie);
    }

    const response = await fetch(input, {
      ...init,
      headers
    });
    this.storeSetCookies(response.headers);
    return response;
  }

  cookieHeader(): string | undefined {
    if (this.cookies.size === 0) {
      return undefined;
    }

    return Array.from(this.cookies.values()).join("; ");
  }

  private storeSetCookies(headers: Headers): void {
    for (const cookie of readSetCookies(headers)) {
      const firstPart = cookie.split(";", 1)[0]?.trim();
      if (!firstPart) {
        continue;
      }

      const separator = firstPart.indexOf("=");
      if (separator <= 0) {
        continue;
      }

      const name = firstPart.slice(0, separator);
      const value = firstPart.slice(separator + 1);
      this.cookies.set(name, `${name}=${value}`);
    }
  }
}

function readSetCookies(headers: Headers): string[] {
  const maybeHeaders = headers as Headers & {
    getSetCookie?: () => string[];
    toJSON?: () => Record<string, string | string[]>;
  };

  if (typeof maybeHeaders.getSetCookie === "function") {
    return maybeHeaders.getSetCookie();
  }

  const json = maybeHeaders.toJSON?.();
  const fromJson = json?.["set-cookie"];
  if (Array.isArray(fromJson)) {
    return fromJson;
  }
  if (typeof fromJson === "string" && fromJson) {
    return [fromJson];
  }

  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}
