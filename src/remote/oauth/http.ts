export interface AuthorizeRequest {
  body?: Record<string, unknown>;
  headers: {
    cookie?: string;
  };
  method: string;
}

export interface AuthorizeResponse {
  appendHeader(name: string, value: string): void;
  redirect(status: number, url: string): void;
  req: AuthorizeRequest;
  send(body: string): void;
  setHeader(name: string, value: string | string[]): void;
  status(code: number): AuthorizeResponse;
  type(contentType: string): AuthorizeResponse;
}

export class BunAuthorizeResponse implements AuthorizeResponse {
  readonly req: AuthorizeRequest;
  private body: BodyInit | null = null;
  private headers = new Headers();
  private statusCode = 200;

  constructor(request: AuthorizeRequest) {
    this.req = request;
  }

  appendHeader(name: string, value: string): void {
    this.headers.append(name, value);
  }

  redirect(status: number, url: string): void {
    this.statusCode = status;
    this.headers.set("Location", url);
    this.body = null;
  }

  send(body: string): void {
    this.body = body;
  }

  setHeader(name: string, value: string | string[]): void {
    if (Array.isArray(value)) {
      this.headers.delete(name);
      for (const entry of value) {
        this.headers.append(name, entry);
      }
      return;
    }
    this.headers.set(name, value);
  }

  status(code: number): AuthorizeResponse {
    this.statusCode = code;
    return this;
  }

  toResponse(): Response {
    if (this.headers.get("Content-Type")?.startsWith("text/html")) {
      if (!this.headers.has("Cache-Control")) {
        this.headers.set("Cache-Control", "no-store");
      }
      if (!this.headers.has("Content-Security-Policy")) {
        this.headers.set(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
        );
      }
      if (!this.headers.has("Referrer-Policy")) {
        this.headers.set("Referrer-Policy", "no-referrer");
      }
      if (!this.headers.has("X-Frame-Options")) {
        this.headers.set("X-Frame-Options", "DENY");
      }
    }

    return new Response(this.body, {
      headers: this.headers,
      status: this.statusCode
    });
  }

  type(contentType: string): AuthorizeResponse {
    this.headers.set(
      "Content-Type",
      contentType === "html" ? "text/html; charset=utf-8" : contentType
    );
    return this;
  }
}
