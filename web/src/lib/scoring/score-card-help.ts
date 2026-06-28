import type { ScoreBreakdown } from './score-calculator';
import type { FreeSpeakMetadata } from './free-speak';

export type ScoreRowKey = keyof Omit<ScoreBreakdown, 'composite'>;

export interface ScoreRowHelp {
  short: string;
  detail: string;
  weightPercent?: number;
}

export interface ScoreHelp {
  rows?: Partial<Record<ScoreRowKey, ScoreRowHelp>>;
  composite?: {
    short: string;
    detail: string;
  };
}

export interface CustomScoreRow {
  key: string;
  label: string;
  score: number;
  color: string;
  help?: ScoreRowHelp;
}

function tokenCount(text: string | null | undefined): number {
  return (text?.match(/[\p{L}\p{N}']+/gu) ?? []).length;
}

export const STANDARD_SCORE_HELP: ScoreHelp = {
  rows: {
    targetMatch: {
      short: 'Checks whether your words matched the target.',
      detail: 'This compares the recognized transcript with the expected word, phrase, or sentence. Extra words, missing words, and wrong words reduce the score.',
    },
    pronunciation: {
      short: 'Checks how clearly the target sounds were produced.',
      detail: 'When Azure pronunciation is configured, this uses word and phoneme evidence. Otherwise it falls back to basic transcript and phoneme similarity.',
    },
    fluency: {
      short: 'Checks pace and pauses for longer speech.',
      detail: 'For sentences and free speech, this uses speech rate, pauses, and run length. Single-word stages usually hide this row because speed is less meaningful there.',
    },
    completeness: {
      short: 'Checks whether required words were included.',
      detail: 'This rewards saying the full target. Skipped words, partial answers, and unfinished phrases lower the score.',
    },
    consistency: {
      short: 'Checks recent performance stability.',
      detail: "After prior attempts, this compares the current score with the student's best and latest attempts so progress is not based on one lucky result.",
    },
  },
  composite: {
    short: 'The final score blends the stage rubric and applies safety caps when the answer is too short or off target.',
    detail: 'The exact blend depends on the learner level and stage. A fluent wrong answer is still capped so it cannot pass as correct.',
  },
};

export const FREE_SPEAK_COMPOSITE_HELP: ScoreHelp = {
  composite: {
    short: 'Free Speak blends target use, content, fluency, and sentence length. Missing the target caps the result at 45%.',
    detail: 'Target use and content are the largest parts of the score. AI checks only whether the sentence makes sense; the app checks the target word or phrase and measured fluency separately.',
  },
};

export function buildFreeSpeakRows(
  scores: ScoreBreakdown,
  metadata: FreeSpeakMetadata | null,
  targetText: string | null | undefined,
): CustomScoreRow[] {
  const label = tokenCount(targetText) > 1 ? 'Target Phrase' : 'Target Word';
  return [
    {
      key: 'target',
      label,
      score: scores.targetMatch,
      color: 'bg-blue-500',
      help: {
        short: 'Did you use the displayed vocabulary item?',
        detail: 'Single words must appear as an exact word or a known homophone. Phrases must appear as the exact normalized word sequence.',
        weightPercent: 35,
      },
    },
    {
      key: 'content',
      label: 'Content',
      score: metadata?.contentScore ?? 0,
      color: 'bg-emerald-500',
      help: {
        short: 'Does your sentence make sense in English?',
        detail: 'AI judges coherence only. It does not decide whether you used the target word and it does not override measured fluency.',
        weightPercent: 35,
      },
    },
    {
      key: 'fluency',
      label: 'Fluency',
      score: scores.fluency,
      color: 'bg-amber-500',
      help: {
        short: 'Pace, pauses, and run length.',
        detail: 'This is calculated from speech rate, pause count, and how many words you can say in a smooth run.',
        weightPercent: 20,
      },
    },
    {
      key: 'sentence',
      label: 'Sentence',
      score: scores.completeness,
      color: 'bg-purple-500',
      help: {
        short: 'Long enough to count as a real sentence.',
        detail: 'One-word answers and very short fragments are capped because Free Speak is meant to practice producing a complete idea.',
        weightPercent: 10,
      },
    },
  ];
}
