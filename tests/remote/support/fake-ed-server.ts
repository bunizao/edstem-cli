export interface FakeEdUser {
  answerResult?: {
    correct?: boolean | null;
    explanation?: unknown;
    slide_completed?: boolean;
    solution?: unknown;
  };
  courses: Array<{
    course: {
      code: string;
      id: number;
      name: string;
      session: string;
      status: string;
      year: string;
    };
    role: {
      role: string;
    };
  }>;
  token: string;
  user: {
    avatar: string;
    course_role: string;
    email: string;
    id: number;
    name: string;
    role: string;
  };
}

export async function startFakeEdServer(users: FakeEdUser[]) {
  const submissions = {
    answers: [] as Array<{
      amend: boolean;
      body: unknown;
      questionId: number;
      token: string;
    }>,
    slides: [] as Array<{
      slideId: number;
      token: string;
    }>
  };

  const byToken = new Map(users.map((user) => [user.token, user]));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const token = getToken(request.headers.get("authorization"));
      const user = token ? byToken.get(token) : undefined;

      if (request.method === "GET" && url.pathname === "/api/user") {
        if (!user) {
          return jsonResponse({ code: "bad_token", message: "invalid token" }, 401);
        }
        return jsonResponse({
          courses: user.courses,
          user: user.user
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/lessons/slides/questions/" + extractId(url.pathname, 5) + "/responses"
      ) {
        if (!user) {
          return jsonResponse({ code: "bad_token", message: "invalid token" }, 401);
        }

        const questionId = Number.parseInt(extractId(url.pathname, 5), 10);
        submissions.answers.push({
          amend: url.searchParams.get("amend") === "1",
          body: await request.json(),
          questionId,
          token: user.token
        });

        return jsonResponse({
          correct: user.answerResult?.correct ?? true,
          explanation: user.answerResult?.explanation ?? null,
          slide_completed: user.answerResult?.slide_completed ?? true,
          solution: user.answerResult?.solution ?? [1]
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/lessons/slides/" + extractId(url.pathname, 4) + "/questions/submit_all"
      ) {
        if (!user) {
          return jsonResponse({ code: "bad_token", message: "invalid token" }, 401);
        }

        const slideId = Number.parseInt(extractId(url.pathname, 4), 10);
        submissions.slides.push({
          slideId,
          token: user.token
        });

        return jsonResponse({ submitted: true });
      }

      return new Response("not found", { status: 404 });
    }
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/api/`,
    close: async () => {
      server.stop(true);
    },
    revokeToken(token: string) {
      byToken.delete(token);
    },
    submissions
  };
}

function getToken(authorization: string | null): string | undefined {
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  return authorization.slice("Bearer ".length);
}

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json"
    },
    status
  });
}

function extractId(pathname: string, index: number): string {
  return pathname.split("/")[index] ?? "";
}
