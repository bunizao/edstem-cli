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
  index: number;
  status: string;
  isHidden: boolean;
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

export interface ThreadMetrics {
  voteCount: number;
  viewCount: number;
  uniqueViewCount: number;
  replyCount: number;
  unresolvedCount: number;
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
  createdAt: string;
  updatedAt: string;
  author: User | null;
}

export interface UserWithCourses {
  user: User;
  courses: Course[];
}
