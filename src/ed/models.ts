export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  courseRole: string;
  avatar: string;
}

export interface Course {
  id: number;
  code: string;
  name: string;
  year: string;
  session: string;
  status: string;
  role: string;
}

export interface LessonModule {
  id: number;
  courseId: number;
  name: string;
  userId: number;
  createdAt: string;
  updatedAt: string;
}

export interface LessonSlide {
  id: number;
  lessonId: number;
  courseId: number;
  title: string;
  type: string;
  content: string;
  fileUrl: string;
  index: number;
  status: string;
  isHidden: boolean;
}

export interface LessonFile {
  lessonId?: number;
  slideId?: number;
  slideIndex?: number;
  slideTitle?: string;
  threadId?: number;
  commentId?: number;
  filename: string;
  url: string;
  mediaType?: string;
  source: "slide" | "content" | "thread" | "comment";
}

export interface Lesson {
  id: number;
  courseId: number;
  moduleId: number;
  moduleName: string;
  number: number;
  title: string;
  type: string;
  kind: string;
  state: string;
  status: string;
  outline: string;
  slideCount: number;
  slides: LessonSlide[];
  openable: boolean;
  openableWithoutAttempt: boolean;
  isHidden: boolean;
  isUnlisted: boolean;
  isTimed: boolean;
  availableAt: string;
  dueAt: string;
  lockedAt: string;
  solutionsAt: string;
  /** When the signed-in user last submitted, from the lesson list; empty if they never did. */
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface LessonQuestion {
  id: number;
  slideId: number;
  index: number;
  type: string;
  content: string;
  explanation: string;
  answers: string[];
  solution: number[];
  multipleSelection: boolean;
  isAssessed: boolean;
  isFormatted: boolean;
  lessonMarkableId: number;
}

export interface LessonQuestionResponse {
  questionId: number;
  userId: number;
  createdAt: string;
  correct: boolean | null;
  data: unknown;
}

export interface LessonAttempt {
  id: number;
  lessonId: number;
  userId: number;
  submittedAt: string;
  /** A staff-set final mark that replaces the calculated one; may be zero. */
  markOverride: number | null;
}

export interface LessonAttempts {
  attempts: LessonAttempt[];
  /** The attempt Ed marks, or null when nothing was submitted. */
  finalId: number | null;
}

export interface LessonMarkingStatus {
  userId: number;
  mark: number | null;
  /** Maximum points per markable slide; empty when Ed's totals are missing or unreadable. */
  slideTotals: number[];
  /** Everyone still unmarked; only used to check the requesting user. */
  unmarkedUserIds: number[];
}

export type GradeStatus = "graded" | "ungraded" | "unreleased" | "not_submitted" | "unavailable";

export interface Grade {
  lessonId: number;
  title: string;
  status: GradeStatus;
  grade: number | null;
  /** Derived: the sum of Ed's slide totals for the lesson. */
  max: number | null;
  submittedAt: string;
  /** Why Ed could not report this lesson, when status is unavailable. */
  error?: string;
}

export interface ThreadMetrics {
  voteCount: number;
  viewCount: number;
  uniqueViewCount: number;
  replyCount: number;
  unresolvedCount: number;
  newReplyCount: number;
  starCount: number;
  flagCount: number;
}

export interface Comment {
  id: number;
  content: string;
  document: string;
  type: string;
  userId: number;
  voteCount: number;
  vote: number;
  isEndorsed: boolean;
  isAnonymous: boolean;
  isResolved: boolean;
  createdAt: string;
  comments: Comment[];
  author: User | null;
}

export interface Thread {
  id: number;
  number: number;
  title: string;
  content: string;
  document: string;
  type: string;
  category: string;
  subcategory: string;
  subsubcategory: string;
  metrics: ThreadMetrics;
  answers: Comment[];
  comments: Comment[];
  userId: number;
  courseId: number;
  isPinned: boolean;
  isPrivate: boolean;
  isEndorsed: boolean;
  isAnswered: boolean;
  isAnonymous: boolean;
  isLocked: boolean;
  isSeen: boolean;
  isStarred: boolean;
  isWatched: boolean | null;
  vote: number;
  createdAt: string;
  updatedAt: string;
  author: User | null;
}

export interface UserWithCourses {
  user: User;
  courses: Course[];
}
