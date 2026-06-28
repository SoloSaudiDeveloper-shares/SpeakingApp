export type WidgetId = 'quick-practice' | 'speaking-profile' | 'klp-focus' | 'stages' | 'stats' | 'mastery' | 'recent-attempts' | 'ai-coach' | 'streaks' | 'leaderboard';

export interface WidgetConfig {
  id: WidgetId;
  title: string;
  description: string;
  defaultSize: 'small' | 'medium' | 'large'; // small=1col, medium=1col tall, large=2col
  removable: boolean;
}

export const AVAILABLE_WIDGETS: WidgetConfig[] = [
  { id: 'quick-practice', title: 'Quick Practice', description: 'Continue where you left off', defaultSize: 'large', removable: false },
  { id: 'speaking-profile', title: 'Your Speaking Profile', description: 'Level, weakest skill, and recommended path', defaultSize: 'large', removable: true },
  { id: 'klp-focus', title: 'Lesson Speaking Focus', description: 'Book and lesson curriculum context', defaultSize: 'large', removable: true },
  { id: 'stats', title: 'My Stats', description: 'Mastered words, attempts, average score', defaultSize: 'large', removable: true },
  { id: 'stages', title: 'Practice Stages', description: 'Your learning path through all 6 stages', defaultSize: 'large', removable: true },
  { id: 'mastery', title: 'Word Mastery', description: 'Color-coded grid of all your words', defaultSize: 'large', removable: true },
  { id: 'recent-attempts', title: 'Recent Attempts', description: 'Your last practice results', defaultSize: 'medium', removable: true },
  { id: 'ai-coach', title: 'AI Tutor Insight', description: 'Personalized progress and next actions', defaultSize: 'large', removable: true },
  { id: 'streaks', title: 'Streaks & Goals', description: 'Daily goals and practice streaks', defaultSize: 'small', removable: true },
  { id: 'leaderboard', title: 'Leaderboard', description: 'Top students in your class', defaultSize: 'medium', removable: true },
];

export const DEFAULT_LAYOUT: WidgetId[] = ['quick-practice', 'speaking-profile', 'ai-coach', 'klp-focus', 'stats', 'stages', 'mastery', 'recent-attempts'];

export interface DiagnosticProfile {
  suggestedCefr?: string;
  fluencyIndex?: number;
  speechRateWpm?: number;
  pronAvg?: number | null;
  contentScore?: number;
  takenAt?: string;
  skillBands?: {
    pronunciation?: string | null;
    fluency?: string;
    sentenceProduction?: string;
    recallReadiness?: string | null;
  };
  strengths?: string[];
  weaknesses?: string[];
  recommendedStartingStage?: string;
  recommendedPracticePath?: Array<{ title: string; href: string; reason: string }>;
}

export interface PracticeData {
  cycle: { id: number; startDate: string; endDate: string } | null;
  book: { id: number; title: string; cefrLevel: string } | null;
  vocabulary: Array<{
    id: number;
    word: string;
    arabicMeaning: string | null;
    klpLinks?: Array<{
      id: number;
      conceptId: string;
      book: string | null;
      lesson: string | null;
      domain: string;
      label: string;
      supportStatus: string;
    }>;
  }>;
  tasks: Array<{ id: number; taskType: string; prompt: string; vocabularyItemId: number | null; passScore?: number }>;
  attempts: Array<{ id: number; compositeScore: number; practiceTaskId: number; timestamp: string; metricsJson?: string | null }>;
  mastery: Array<{ vocabularyItemId: number; masteryStatus: string; bestScore: number; vocabulary?: { word: string } }>;
  student: { id: number; displayName: string | null; cefrBand?: string | null; diagnosticJson?: string | null; onboardedAt?: string | null };
  diagnostic?: DiagnosticProfile | null;
  /** Admin-controlled stage configuration (sequence + unlock mode). */
  stageConfig?: {
    sequence: string[];
    unlockMode: 'all' | 'sequential' | 'free';
  };
}
