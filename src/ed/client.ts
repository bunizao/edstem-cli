import type {
  Comment,
  Course,
  Lesson,
  LessonModule,
  LessonQuestion,
  LessonQuestionResponse,
  LessonSlide,
  Thread,
  ThreadMetrics,
  User,
  UserWithCourses
} from "./models.js";

export class EdApiError extends Error {
  readonly kind: "api" | "auth_expired" | "base_url" | "upstream";
  readonly statusCode: number;

  constructor(
    kind: "api" | "auth_expired" | "base_url" | "upstream",
    statusCode: number,
    message: string
  ) {
    super(message);
    this.kind = kind;
    this.name = "EdApiError";
    this.statusCode = statusCode;
  }
}

export class EdAuthExpiredError extends EdApiError {
  constructor(statusCode: number, message: string) {
    super("auth_expired", statusCode, message);
    this.name = "EdAuthExpiredError";
  }
}

export interface SlideAnswerResult {
  correct: boolean | null;
  explanation: unknown;
  slideCompleted: boolean;
  solution: unknown;
}

export interface SlideSubmitResult {
  submitted: boolean;
}

export interface EdClientOptions {
  apiBaseUrl?: string;
  fetch?: FetchLike;
  token: string;
  timeoutMs?: number;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class EdClient {
  private readonly apiBaseUrl: string;
  private readonly fetch: FetchLike;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: EdClientOptions) {
    this.apiBaseUrl = ensureTrailingSlash(
      options.apiBaseUrl ?? getEnvironmentValue("ED_API_BASE_URL") ?? "https://edstem.org/api/"
    );
    this.fetch = options.fetch ?? globalThis.fetch;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async fetchCourseThread(courseId: number, number: number): Promise<Thread> {
    const data = await this.get(`courses/${courseId}/threads/${number}`);
    const users = buildUsersMap(asArray(data.users));
    return parseThread(asRecord(data.thread ?? data), users);
  }

  async fetchLesson(lessonId: number, options: { view?: boolean } = {}): Promise<Lesson> {
    const data = await this.get(
      `lessons/${lessonId}`,
      options.view ? { view: "1" } : undefined
    );
    return parseLesson(asRecord(data.lesson ?? data));
  }

  async fetchSlide(slideId: number, options: { view?: boolean } = {}): Promise<LessonSlide> {
    const data = await this.get(
      `lessons/slides/${slideId}`,
      options.view ? { view: "1" } : undefined
    );
    return parseLessonSlide(asRecord(data.slide ?? data));
  }

  async completeSlide(slideId: number): Promise<void> {
    await this.request("PUT", `lessons/slides/${slideId}/complete`, { allowEmpty: true });
  }

  async fetchLessons(courseId: number): Promise<{ lessons: Lesson[]; modules: LessonModule[] }> {
    const data = await this.get(`courses/${courseId}/lessons`);
    const modules = asArray(data.modules).map((entry) => parseLessonModule(asRecord(entry)));
    const moduleNames = new Map<number, string>(modules.map((module) => [module.id, module.name]));
    const lessons = asArray(data.lessons).map((entry) =>
      parseLesson(asRecord(entry), moduleNames)
    );
    return { lessons, modules };
  }

  async fetchSlideQuestionResponses(slideId: number): Promise<LessonQuestionResponse[]> {
    const data = await this.get(`lessons/slides/${slideId}/questions/responses`);
    return asArray(data.responses).map((entry) =>
      parseLessonQuestionResponse(asRecord(entry))
    );
  }

  async fetchSlideQuestions(slideId: number): Promise<LessonQuestion[]> {
    const data = await this.get(`lessons/slides/${slideId}/questions`);
    return asArray(data.questions).map((entry) => parseLessonQuestion(asRecord(entry)));
  }

  async fetchThread(threadId: number): Promise<Thread> {
    const data = await this.get(`threads/${threadId}`);
    const users = buildUsersMap(asArray(data.users));
    return parseThread(asRecord(data.thread ?? data), users);
  }

  async fetchThreads(
    courseId: number,
    options: { limit?: number; offset?: number; sort?: string } = {}
  ): Promise<Thread[]> {
    const data = await this.get(`courses/${courseId}/threads`, {
      limit: String(Math.min(options.limit ?? 30, 100)),
      offset: String(options.offset ?? 0),
      sort: options.sort ?? "new"
    });
    const threads = Array.isArray(data.threads) ? data.threads : Array.isArray(data) ? data : [];
    return threads.map((entry) => parseThread(asRecord(entry)));
  }

  async fetchUser(): Promise<UserWithCourses> {
    const data = await this.get("user");
    const userData = asRecord(data.user);
    const user = parseUser(userData);
    const courses = asArray(data.courses).map((enrollment) => {
      const record = asRecord(enrollment);
      const course = asRecord(record.course);
      const role = asRecord(record.role);
      return parseCourse(course, asString(role.role));
    });
    return { courses, user };
  }

  async fetchUserActivity(
    userId: number,
    options: { courseId?: number; filterType?: string; limit?: number; offset?: number } = {}
  ): Promise<unknown[]> {
    const params: Record<string, string> = {
      filter: options.filterType ?? "all",
      limit: String(Math.min(options.limit ?? 30, 50)),
      offset: String(options.offset ?? 0)
    };
    if (options.courseId) {
      params.course_id = String(options.courseId);
    }
    const data = await this.get(`users/${userId}/profile/activity`, params);
    return asArray(data.items);
  }

  async submitSlide(slideId: number): Promise<SlideSubmitResult> {
    const data = await this.post(`lessons/slides/${slideId}/questions/submit_all`, {
      allowEmpty: true,
      jsonBody: {}
    });

    if (!data) {
      return { submitted: true };
    }

    return {
      submitted: Boolean(data.submitted)
    };
  }

  async submitSlideAnswer(
    questionId: number,
    choices: number[],
    options: { amend?: boolean } = {}
  ): Promise<SlideAnswerResult> {
    const data = await this.post(`lessons/slides/questions/${questionId}/responses`, {
      jsonBody: choices,
      params: options.amend ? { amend: "1" } : undefined
    });
    if (!data) {
      throw new EdApiError("upstream", 0, "Ed API returned an empty response.");
    }

    return {
      correct: typeof data.correct === "boolean" ? data.correct : null,
      explanation: data.explanation ?? null,
      slideCompleted: Boolean(data.slide_completed),
      solution: data.solution ?? null
    };
  }

  private async get(
    path: string,
    params?: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const payload = await this.request("GET", path, { params });
    return payload ?? {};
  }

  private async post(
    path: string,
    options: {
      allowEmpty?: boolean;
      jsonBody?: unknown;
      params?: Record<string, string>;
    } = {}
  ): Promise<Record<string, unknown> | null> {
    return this.request("POST", path, options);
  }

  private async request(
    method: "GET" | "POST" | "PUT",
    path: string,
    options: {
      allowEmpty?: boolean;
      jsonBody?: unknown;
      params?: Record<string, string>;
    } = {}
  ): Promise<Record<string, unknown> | null> {
    const url = new URL(path.replace(/^\/+/, ""), this.apiBaseUrl);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await this.fetch(url, {
        body: options.jsonBody === undefined ? undefined : JSON.stringify(options.jsonBody),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(options.jsonBody === undefined ? {} : { "Content-Type": "application/json" })
        },
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new EdApiError("upstream", 0, `Failed to reach the Ed API: ${detail}`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "an unknown location";
      throw new EdApiError(
        "base_url",
        response.status,
        `Ed API base URL redirected to ${location}. Set ED_API_BASE_URL to a valid JSON API endpoint.`
      );
    }

    const rawBody = await response.text();
    const errorPayload = safeParseJson(rawBody) ?? {};
    const code = asString(errorPayload.code);
    const message = asString(errorPayload.message);

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      if (code === "bad_token" || response.status === 401) {
        throw new EdAuthExpiredError(
          response.status,
          `Authentication failed (HTTP ${response.status}). Check your Ed API token.`
        );
      }
      throw new EdApiError("api", response.status, formatApiError(response.status, message));
    }

    if (response.status === 404) {
      throw new EdApiError("api", response.status, message || `Not found: ${path}`);
    }

    if (!response.ok) {
      throw new EdApiError("upstream", response.status, formatApiError(response.status, message));
    }

    if (!rawBody.trim()) {
      if (options.allowEmpty) {
        return null;
      }
      throw new EdApiError(
        "base_url",
        response.status,
        "Ed API returned a non-JSON response. Set ED_API_BASE_URL to a valid JSON API endpoint."
      );
    }

    const payload = safeParseJson(rawBody);
    if (!payload) {
      throw new EdApiError(
        "base_url",
        response.status,
        "Ed API returned a non-JSON response. Set ED_API_BASE_URL to a valid JSON API endpoint."
      );
    }

    return payload;
  }
}

function safeParseJson(rawBody: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(rawBody));
  } catch {
    return null;
  }
}

function formatApiError(statusCode: number, message: string): string {
  if (message) {
    return `Ed API error (HTTP ${statusCode}): ${message}`;
  }
  return `Ed API error (HTTP ${statusCode})`;
}

function buildUsersMap(entries: unknown[]): Map<number, User> {
  return new Map(
    entries
      .map((entry) => parseUser(asRecord(entry)))
      .filter((user) => user.id > 0)
      .map((user) => [user.id, user] satisfies [number, User])
  );
}

function parseUser(data: Record<string, unknown>): User {
  return {
    avatar: asString(data.avatar),
    courseRole: asString(data.course_role),
    email: asString(data.email),
    id: asInt(data.id),
    name: asString(data.name),
    role: asString(data.role)
  };
}

function parseCourse(data: Record<string, unknown>, role = ""): Course {
  return {
    code: asString(data.code),
    id: asInt(data.id),
    name: asString(data.name),
    role,
    session: asString(data.session),
    status: asString(data.status),
    year: asString(data.year)
  };
}

function parseLessonModule(data: Record<string, unknown>): LessonModule {
  return {
    courseId: asInt(data.course_id),
    createdAt: asString(data.created_at),
    id: asInt(data.id),
    name: asString(data.name),
    updatedAt: asString(data.updated_at),
    userId: asInt(data.user_id)
  };
}

function parseLessonSlide(data: Record<string, unknown>): LessonSlide {
  const slideData = asRecord(data.data);
  return {
    content:
      asString(data.content) ||
      asString(data.passage) ||
      asString(slideData.content) ||
      asString(slideData.passage),
    courseId: asInt(data.course_id),
    id: asInt(data.id),
    index: asInt(data.index),
    isHidden: Boolean(data.is_hidden),
    lessonId: asInt(data.lesson_id),
    status: asString(data.status),
    title: asString(data.title),
    type: asString(data.type)
  };
}

function parseLessonQuestion(data: Record<string, unknown>): LessonQuestion {
  const question = asRecord(data.data);
  return {
    answers: asArray(question.answers).map((value) => asString(value)),
    content: asString(question.content),
    explanation: asString(question.explanation),
    id: asInt(data.id),
    index: asInt(data.index),
    isAssessed: Boolean(question.assessed),
    isFormatted: Boolean(question.formatted),
    lessonMarkableId: asInt(data.lesson_markable_id),
    multipleSelection: Boolean(question.multiple_selection),
    slideId: asInt(data.lesson_slide_id),
    solution: asArray(question.solution).map((value) => asInt(value)),
    type: asString(question.type)
  };
}

function parseLessonQuestionResponse(data: Record<string, unknown>): LessonQuestionResponse {
  const correct = data.correct;
  return {
    correct: typeof correct === "boolean" ? correct : null,
    createdAt: asString(data.created_at),
    data: data.data ?? null,
    questionId: asInt(data.question_id),
    userId: asInt(data.user_id)
  };
}

function parseLesson(
  data: Record<string, unknown>,
  moduleNames: Map<number, string> = new Map()
): Lesson {
  const moduleId = asInt(data.module_id);
  return {
    availableAt: asString(data.effective_available_at) || asString(data.available_at),
    courseId: asInt(data.course_id),
    createdAt: asString(data.created_at),
    dueAt: asString(data.effective_due_at) || asString(data.due_at),
    id: asInt(data.id),
    isHidden: Boolean(data.is_hidden),
    isTimed: Boolean(data.is_timed),
    isUnlisted: Boolean(data.is_unlisted),
    kind: asString(data.kind),
    lockedAt: asString(data.effective_locked_at) || asString(data.locked_at),
    moduleId,
    moduleName: asString(data.module_name) || moduleNames.get(moduleId) || "",
    number: asInt(data.number),
    openable: Boolean(data.openable),
    openableWithoutAttempt: Boolean(data.openable_without_attempt),
    outline: asString(data.outline),
    slideCount: asInt(data.slide_count),
    slides: asArray(data.slides).map((entry) => parseLessonSlide(asRecord(entry))),
    solutionsAt:
      asString(data.effective_solutions_at) || asString(data.solutions_at),
    state: asString(data.state),
    status: asString(data.status),
    title: asString(data.title),
    type: asString(data.type),
    updatedAt: asString(data.updated_at)
  };
}

function parseThread(
  data: Record<string, unknown>,
  usersMap: Map<number, User> = new Map()
): Thread {
  const userId = asInt(data.user_id);
  return {
    answers: asArray(data.answers).map((entry) => parseComment(asRecord(entry), usersMap)),
    category: asString(data.category),
    author: usersMap.get(userId) ?? null,
    comments: asArray(data.comments).map((entry) => parseComment(asRecord(entry), usersMap)),
    content: asString(data.content),
    courseId: asInt(data.course_id),
    createdAt: asString(data.created_at),
    document: asString(data.document),
    id: asInt(data.id),
    isAnonymous: Boolean(data.is_anonymous),
    isAnswered: Boolean(data.is_answered),
    isEndorsed: Boolean(data.is_endorsed),
    isLocked: Boolean(data.is_locked),
    isPinned: Boolean(data.is_pinned),
    isPrivate: Boolean(data.is_private),
    number: asInt(data.number),
    metrics: parseThreadMetrics(data),
    subcategory: asString(data.subcategory),
    subsubcategory: asString(data.subsubcategory),
    title: asString(data.title),
    type: asString(data.type),
    updatedAt: asString(data.updated_at),
    userId
  };
}

function parseThreadMetrics(data: Record<string, unknown>): ThreadMetrics {
  return {
    flagCount: asInt(data.flag_count),
    replyCount: asInt(data.reply_count),
    starCount: asInt(data.star_count),
    unresolvedCount: asInt(data.unresolved_count),
    uniqueViewCount: asInt(data.unique_view_count),
    viewCount: asInt(data.view_count),
    voteCount: asInt(data.vote_count)
  };
}

function parseComment(
  data: Record<string, unknown>,
  usersMap: Map<number, User> = new Map()
): Comment {
  const userId = asInt(data.user_id);
  return {
    author: usersMap.get(userId) ?? null,
    comments: asArray(data.comments).map((entry) => parseComment(asRecord(entry), usersMap)),
    content: asString(data.content),
    createdAt: asString(data.created_at),
    document: asString(data.document),
    id: asInt(data.id),
    isAnonymous: Boolean(data.is_anonymous),
    isEndorsed: Boolean(data.is_endorsed),
    isResolved: Boolean(data.is_resolved),
    type: asString(data.type),
    userId,
    voteCount: asInt(data.vote_count)
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return Number.parseInt(String(value ?? 0), 10) || 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getEnvironmentValue(name: string): string | undefined {
  const processValue = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  return processValue?.env?.[name];
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
