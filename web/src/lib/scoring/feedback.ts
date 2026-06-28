/**
 * Diagnostic feedback generator.
 * Converts a ScoreBreakdown plus the actual transcript & target into
 * specific, actionable feedback for the student. No vague guesses.
 */

import type { ScoreBreakdown } from './score-calculator';
import { areEquivalentWords, areHomophones } from './homophones';

export type FeedbackLevel = 'excellent' | 'good' | 'fair' | 'needs_work' | 'no_speech';

export interface DimensionFeedback {
  dimension: string;
  score: number;
  level: FeedbackLevel;
  message: string;
  suggestion: string | null;
}

export interface FullFeedback {
  overall: {
    level: FeedbackLevel;
    headline: string;
    summary: string;
  };
  nextFix?: {
    title: string;
    message: string;
  };
  modelAnswer?: string | null;
  nextAction?: 'try_again' | 'shadow_model' | 'move_on';
  strengths: DimensionFeedback[];
  weaknesses: DimensionFeedback[];
  diff: {
    saidWords: string[];
    expectedWords: string[];
    missingWords: string[];   // expected but not said
    extraWords: string[];     // said but not expected
    correctWords: string[];   // said & expected
  } | null;
}

const LEVELS = (score: number): FeedbackLevel => {
  if (score === 0) return 'no_speech';
  if (score >= 0.9) return 'excellent';
  if (score >= 0.75) return 'good';
  if (score >= 0.5) return 'fair';
  return 'needs_work';
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[.,!?;:'"]+/g, ''))
    .filter(Boolean);
}

function diffWords(transcript: string, expectedAnswers: string[]) {
  if (!transcript || !expectedAnswers.length) return null;

  const said = tokenize(transcript);
  // Pick the expected answer with the most word overlap
  let bestMatch = expectedAnswers[0];
  let bestOverlap = -1;
  const saidSet = new Set(said);
  for (const exp of expectedAnswers) {
    const expWords = tokenize(exp);
    const overlap = expWords.filter((w) => saidSet.has(w)).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = exp;
    }
  }

  const expected = tokenize(bestMatch);
  const correct: string[] = [];
  const extra: string[] = [];
  const used = new Set<number>();

  for (const expectedWord of expected) {
    const idx = said.findIndex((saidWord, i) => !used.has(i) && areEquivalentWords(expectedWord, saidWord));
    if (idx >= 0) {
      correct.push(expectedWord);
      used.add(idx);
    }
  }

  for (let i = 0; i < said.length; i++) {
    if (!used.has(i)) extra.push(said[i]);
  }

  const correctSet = new Set(correct);
  const missing = expected.filter((w) => !correctSet.has(w));

  return {
    saidWords: said,
    expectedWords: expected,
    missingWords: missing,
    extraWords: extra,
    correctWords: Array.from(new Set(correct)),
  };
}

function singleWordHomophoneAmbiguity(transcript: string, expectedAnswers: string[]): { said: string; expected: string } | null {
  const expected = tokenize(expectedAnswers[0] ?? '');
  const said = tokenize(transcript);
  if (expected.length === 1 && said.length === 1 && areHomophones(expected[0], said[0])) {
    return { said: said[0], expected: expected[0] };
  }
  return null;
}

function modelAnswerFrom(expectedAnswers: string[]) {
  return expectedAnswers.find((answer) => answer.trim())?.trim() ?? null;
}

function pickNextFix(
  overallLevel: FeedbackLevel,
  dimensions: DimensionFeedback[],
  expectedAnswers: string[],
): { nextFix: FullFeedback['nextFix']; nextAction: NonNullable<FullFeedback['nextAction']>; modelAnswer: string | null } {
  const modelAnswer = modelAnswerFrom(expectedAnswers);
  if (overallLevel === 'no_speech') {
    return {
      nextFix: {
        title: 'Try again clearly',
        message: 'Move closer to the microphone, say the model answer once, then stop recording.',
      },
      nextAction: 'try_again',
      modelAnswer,
    };
  }

  const weakest = [...dimensions]
    .filter((dimension) => dimension.score < 0.75)
    .sort((a, b) => a.score - b.score)[0];
  if (weakest) {
    return {
      nextFix: {
        title: `Fix ${weakest.dimension.toLowerCase()} next`,
        message: weakest.suggestion || weakest.message,
      },
      nextAction: modelAnswer ? 'shadow_model' : 'try_again',
      modelAnswer,
    };
  }

  return {
    nextFix: {
      title: 'Keep the same quality',
      message: modelAnswer ? `Shadow the model once more: "${modelAnswer}".` : 'Move on when you are ready.',
    },
    nextAction: modelAnswer ? 'shadow_model' : 'move_on',
    modelAnswer,
  };
}

export function generateFeedback(
  breakdown: ScoreBreakdown,
  transcript: string,
  expectedAnswers: string[],
  audioDurationSeconds: number,
): FullFeedback {
  const compositeLevel = LEVELS(breakdown.composite);
  const diff = diffWords(transcript, expectedAnswers);
  const homophoneAmbiguity = singleWordHomophoneAmbiguity(transcript, expectedAnswers);

  // ── Per-dimension feedback ─────────────────────────────────────────────
  const dimensions: DimensionFeedback[] = [
    buildTargetMatchFeedback(breakdown.targetMatch, transcript, expectedAnswers, diff),
    buildPronunciationFeedback(breakdown.pronunciation, transcript, expectedAnswers, diff),
    buildFluencyFeedback(breakdown.fluency, transcript, audioDurationSeconds),
    buildCompletenessFeedback(breakdown.completeness, diff),
  ];

  const strengths = dimensions.filter((d) => d.score >= 0.75);
  const weaknesses = dimensions.filter((d) => d.score < 0.75 && d.score > 0);

  // ── Overall headline ────────────────────────────────────────────────────
  let headline: string;
  let summary: string;

  if (compositeLevel === 'no_speech') {
    headline = 'No speech detected';
    summary = 'We didn\'t hear anything. Try moving closer to the microphone, speak clearly, and tap the speak button to try again.';
  } else if (diff?.extraWords.length) {
    headline = compositeLevel === 'needs_work' ? 'Keep practicing' : 'Good target, extra words';
    summary = `You said "${transcript.trim()}". The target was "${expectedAnswers[0]}". Remove the extra word${diff.extraWords.length > 1 ? 's' : ''}: "${diff.extraWords.join('", "')}".`;
  } else if (homophoneAmbiguity) {
    headline = 'Needs context';
    summary = `"${homophoneAmbiguity.said}" sounds like "${homophoneAmbiguity.expected}" by itself. Practice it in a full sentence so the meaning is clear from context.`;
  } else if (compositeLevel === 'excellent') {
    headline = 'Excellent work!';
    summary = `You said "${transcript.trim()}" perfectly. Keep up the great work!`;
  } else if (compositeLevel === 'good') {
    headline = 'Good job!';
    summary = `You said "${transcript.trim()}" — very close to the target. ${weaknesses.length > 0 ? `Focus on ${weaknesses[0].dimension.toLowerCase()} to improve further.` : ''}`;
  } else if (compositeLevel === 'fair') {
    headline = 'Getting there';
    summary = `You said "${transcript.trim()}". The target was "${expectedAnswers[0]}". ${weaknesses.length > 0 ? weaknesses[0].suggestion ?? '' : ''}`;
  } else {
    headline = 'Keep practicing';
    summary = `You said "${transcript.trim()}", but the target was "${expectedAnswers[0]}". Listen to the audio again and try to match the sounds more closely.`;
  }

  const focused = pickNextFix(compositeLevel, dimensions, expectedAnswers);

  return {
    overall: { level: compositeLevel, headline, summary },
    ...focused,
    strengths,
    weaknesses,
    diff,
  };
}

// ─── Per-dimension builders ─────────────────────────────────────────────────

function buildTargetMatchFeedback(
  score: number,
  transcript: string,
  expectedAnswers: string[],
  diff: ReturnType<typeof diffWords>,
): DimensionFeedback {
  const level = LEVELS(score);
  if (score === 0 && !transcript.trim()) {
    return {
      dimension: 'Target Match',
      score, level,
      message: 'Nothing was recognized.',
      suggestion: 'Try speaking louder and clearer.',
    };
  }
  if (score >= 0.95) {
    const expected = expectedAnswers[0]?.trim() ?? '';
    const said = transcript.trim();
    const expectedWords = expected.split(/\s+/).filter(Boolean);
    const saidWords = said.split(/\s+/).filter(Boolean);
    if (
      expectedWords.length === 1 &&
      saidWords.length === 1 &&
      expected.toLowerCase() !== said.toLowerCase() &&
      areEquivalentWords(expected, said)
    ) {
      return {
        dimension: 'Target Match',
        score, level,
        message: `"${said}" sounds like "${expected}" in isolated speech.`,
        suggestion: 'Practice it in a full sentence so the meaning is clear from context.',
      };
    }
    return {
      dimension: 'Target Match',
      score, level,
      message: `Perfect — you said exactly "${expectedAnswers[0]}".`,
      suggestion: null,
    };
  }
  if (score >= 0.75) {
    return {
      dimension: 'Target Match',
      score, level,
      message: `Very close to the target.`,
      suggestion: diff && diff.missingWords.length > 0
        ? `Missing: "${diff.missingWords.join('", "')}".`
        : 'Try to match the target more precisely.',
    };
  }
  if (score >= 0.5) {
    return {
      dimension: 'Target Match',
      score, level,
      message: `Partial match. You said "${transcript.trim()}".`,
      suggestion: `Listen to the example and repeat: "${expectedAnswers[0]}".`,
    };
  }
  return {
    dimension: 'Target Match',
    score, level,
    message: `That didn't match the target.`,
    suggestion: `The target was "${expectedAnswers[0]}". Listen carefully and try again.`,
  };
}

function buildPronunciationFeedback(
  score: number,
  transcript: string,
  expectedAnswers: string[],
  diff: ReturnType<typeof diffWords>,
): DimensionFeedback {
  const level = LEVELS(score);
  if (score === 0) {
    return {
      dimension: 'Pronunciation',
      score, level,
      message: 'No clear pronunciation detected.',
      suggestion: null,
    };
  }
  if (score >= 0.95) {
    return {
      dimension: 'Pronunciation',
      score, level,
      message: 'Your pronunciation was clear and accurate.',
      suggestion: null,
    };
  }
  if (score >= 0.75) {
    return {
      dimension: 'Pronunciation',
      score, level,
      message: 'Good pronunciation overall.',
      suggestion: 'Listen to the example one more time and notice the vowel sounds.',
    };
  }
  if (score >= 0.5) {
    return {
      dimension: 'Pronunciation',
      score, level,
      message: 'Some sounds were unclear.',
      suggestion: diff && diff.missingWords.length > 0
        ? `Practice these words: "${diff.missingWords.slice(0, 3).join('", "')}".`
        : `Slow down and try to match each sound in "${expectedAnswers[0]}".`,
    };
  }
  return {
    dimension: 'Pronunciation',
    score, level,
    message: 'Pronunciation needs work.',
    suggestion: `Listen carefully to the audio, then repeat slowly: "${expectedAnswers[0]}".`,
  };
}

function buildFluencyFeedback(
  score: number,
  transcript: string,
  audioDurationSeconds: number,
): DimensionFeedback {
  const level = LEVELS(score);
  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const secsPerWord = wordCount > 0 ? audioDurationSeconds / wordCount : 0;

  if (score === 0) {
    return {
      dimension: 'Fluency',
      score, level,
      message: 'No speech to measure fluency.',
      suggestion: null,
    };
  }
  if (score >= 0.9) {
    return {
      dimension: 'Fluency',
      score, level,
      message: 'Smooth, natural pace.',
      suggestion: null,
    };
  }
  // Any strength-level score (>= 0.75) must get a positive message — never
  // contradict itself by saying "you hesitated" while listed under strengths.
  if (score >= 0.75) {
    return {
      dimension: 'Fluency',
      score, level,
      message: 'Good, steady pace.',
      suggestion: null,
    };
  }
  if (audioDurationSeconds < 0.3) {
    return {
      dimension: 'Fluency',
      score, level,
      message: 'That was very fast.',
      suggestion: 'Take a breath and speak at a natural pace.',
    };
  }
  if (secsPerWord > 1.5 || (wordCount === 1 && audioDurationSeconds > 3)) {
    return {
      dimension: 'Fluency',
      score, level,
      message: 'You hesitated quite a bit.',
      suggestion: 'Try to speak more confidently. It\'s okay to make mistakes!',
    };
  }
  if (score >= 0.6) {
    return {
      dimension: 'Fluency',
      score, level,
      message: 'A bit slow but understandable.',
      suggestion: 'With practice, your speed will improve naturally.',
    };
  }
  return {
    dimension: 'Fluency',
    score, level,
    message: 'Pace was off.',
    suggestion: 'Aim for a steady, even rhythm.',
  };
}

function buildCompletenessFeedback(
  score: number,
  diff: ReturnType<typeof diffWords>,
): DimensionFeedback {
  const level = LEVELS(score);
  if (score === 0) {
    return {
      dimension: 'Completeness',
      score, level,
      message: 'No words matched the target.',
      suggestion: null,
    };
  }
  if (score >= 0.95) {
    return {
      dimension: 'Completeness',
      score, level,
      message: 'You said all the expected words.',
      suggestion: null,
    };
  }
  if (diff && diff.missingWords.length > 0) {
    return {
      dimension: 'Completeness',
      score, level,
      message: `You missed ${diff.missingWords.length} word${diff.missingWords.length > 1 ? 's' : ''}.`,
      suggestion: `Don\'t skip: "${diff.missingWords.join('", "')}".`,
    };
  }
  return {
    dimension: 'Completeness',
    score, level,
    message: 'Some content was missing.',
    suggestion: 'Repeat the full target phrase, not just part of it.',
  };
}
