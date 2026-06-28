import type { ScoreBreakdown, CefrBand } from './score-calculator';
import type { FullFeedback, FeedbackLevel, DimensionFeedback } from './feedback';
import type { FluencyMetrics } from './fluency-metrics';
import { computeFluencyMetrics, scoreContentQuality } from './fluency-metrics';
import { scoreConsistency } from './consistency';
import type { WordScore } from './azure-pronunciation';
import { areEquivalentWords, normalizeWordToken } from './homophones';

export interface FreeSpeakAiGrade {
  coherence: number | null;
  reason?: string | null;
  fluencyComment?: string | null;
  aiAvailable?: boolean;
  provider?: string | null;
  model?: string | null;
}

export interface FreeSpeakMetadata {
  mode: 'free-speak';
  targetText: string | null;
  targetRequired: boolean;
  targetUseScore: number;
  wordCount: number;
  contentScore: number;
  sentenceScore: number;
  measuredFluency: number;
  offlineContentScore: number;
  aiCoherence: number | null;
  aiReason: string | null;
  aiFluencyComment: string | null;
  aiAvailable: boolean;
  provider: string | null;
  model: string | null;
  provisional: boolean;
  capApplied: number;
  warning: string | null;
}

export interface FreeSpeakScoreInput {
  transcript: string | null | undefined;
  targetText?: string | null;
  requireTargetText?: boolean;
  audioDurationSeconds: number;
  cefrBand: CefrBand;
  fluencyMetrics?: FluencyMetrics | null;
  aiGrade?: FreeSpeakAiGrade | null;
  bestPreviousScore?: number;
  latestPreviousScore?: number;
  previousAttemptCount?: number;
}

export interface PronunciationWeakWordEvidence {
  word: string;
  accuracy: number;
  errorType: string;
  weakPhonemes: Array<{ phoneme: string; accuracy: number }>;
  stage: string;
  capturedAt: string;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function countWords(text: string): number {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).length;
}

function targetTokens(text: string): string[] {
  return (text.match(/[\p{L}\p{N}']+/gu) ?? [])
    .map(normalizeWordToken)
    .filter(Boolean);
}

function scoreTargetUse(transcript: string, targetText: string | null | undefined): number {
  const target = targetTokens(targetText ?? '');
  if (target.length === 0) return 1;

  const spoken = targetTokens(transcript);
  if (spoken.length === 0) return 0;

  if (target.length === 1) {
    return spoken.some((token) => areEquivalentWords(target[0], token)) ? 1 : 0;
  }

  for (let i = 0; i <= spoken.length - target.length; i++) {
    let matched = true;
    for (let j = 0; j < target.length; j++) {
      if (spoken[i + j] !== target[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return 1;
  }

  return 0;
}

function level(score: number): FeedbackLevel {
  if (score === 0) return 'no_speech';
  if (score >= 0.9) return 'excellent';
  if (score >= 0.75) return 'good';
  if (score >= 0.5) return 'fair';
  return 'needs_work';
}

function round3(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function dimension(dimension: string, score: number, message: string, suggestion: string | null = null): DimensionFeedback {
  return { dimension, score: round3(score), level: level(score), message, suggestion };
}

function sentenceSufficiency(wordCount: number, durationSeconds: number): number {
  if (wordCount <= 0 || durationSeconds <= 0) return 0;
  const wordScore = clamp01(wordCount / 4);
  const timeScore = clamp01(durationSeconds / 2);
  return Math.min(wordScore, timeScore);
}

function normalizeAiGrade(aiGrade: FreeSpeakAiGrade | null | undefined): Required<FreeSpeakAiGrade> {
  const coherence = typeof aiGrade?.coherence === 'number' && Number.isFinite(aiGrade.coherence)
    ? clamp01(aiGrade.coherence)
    : null;
  return {
    coherence,
    reason: typeof aiGrade?.reason === 'string' && aiGrade.reason.trim() ? aiGrade.reason.trim() : null,
    fluencyComment: typeof aiGrade?.fluencyComment === 'string' && aiGrade.fluencyComment.trim() ? aiGrade.fluencyComment.trim() : null,
    aiAvailable: aiGrade?.aiAvailable === true && coherence !== null,
    provider: typeof aiGrade?.provider === 'string' && aiGrade.provider.trim() ? aiGrade.provider.trim() : null,
    model: typeof aiGrade?.model === 'string' && aiGrade.model.trim() ? aiGrade.model.trim() : null,
  };
}

function buildFeedback(
  scores: ScoreBreakdown,
  transcript: string,
  metadata: FreeSpeakMetadata,
): FullFeedback {
  let headline: string;
  let summary: string;

  if (!transcript.trim()) {
    headline = 'No speech detected';
    summary = 'We did not hear a response. Try again with one complete sentence.';
  } else if (metadata.wordCount <= 1) {
    headline = 'Say a full sentence';
    summary = `You said "${transcript.trim()}". Free Speak needs a meaningful sentence, not just one word.`;
  } else if (metadata.contentScore < 0.5) {
    headline = 'Make it meaningful';
    summary = metadata.aiReason
      ? metadata.aiReason
      : 'That did not sound like a coherent English response. Try a real sentence with a clear idea.';
  } else if (metadata.targetRequired && metadata.targetUseScore < 1) {
    headline = 'Use the target word';
    summary = `Your sentence was clear, but this stage is for practicing "${metadata.targetText}". Try again with a sentence that includes it.`;
  } else if (metadata.provisional) {
    headline = scores.composite >= 0.6 ? 'Provisional pass' : 'Provisional score';
    summary = metadata.warning ?? 'AI content grading was unavailable, so this score used local checks only.';
  } else if (scores.composite >= 0.85) {
    headline = 'Strong free speaking';
    summary = metadata.aiReason ?? 'Your response was meaningful and fluent.';
  } else if (scores.composite >= 0.6) {
    headline = 'Good free speaking';
    summary = metadata.aiReason ?? 'Your response made sense. Keep building longer, smoother sentences.';
  } else {
    headline = 'Keep practicing';
    summary = metadata.aiReason ?? 'Try a longer, clearer English sentence.';
  }

  const dimensions: DimensionFeedback[] = [
    ...(metadata.targetRequired ? [
      dimension(
        targetTokens(metadata.targetText ?? '').length > 1 ? 'Target Phrase' : 'Target Word',
        metadata.targetUseScore,
        metadata.targetUseScore >= 1 ? `You used "${metadata.targetText}".` : `The sentence did not include "${metadata.targetText}".`,
        metadata.targetUseScore >= 1 ? null : `Use "${metadata.targetText}" in your own sentence.`,
      ),
    ] : []),
    dimension(
      'Content',
      metadata.contentScore,
      metadata.contentScore >= 0.75 ? 'Meaningful response.' : 'The response needs clearer meaning.',
      metadata.contentScore >= 0.75 ? null : 'Say one real sentence with a clear idea.',
    ),
    dimension(
      'Sentence',
      metadata.sentenceScore,
      metadata.sentenceScore >= 0.75 ? 'Long enough for Free Speak.' : 'Too short for Free Speak.',
      metadata.sentenceScore >= 0.75 ? null : 'Use at least a short complete sentence.',
    ),
    dimension(
      'Fluency',
      metadata.measuredFluency,
      metadata.measuredFluency >= 0.75 ? 'Good speaking flow.' : 'The rhythm can be smoother.',
      metadata.aiFluencyComment ?? (metadata.measuredFluency >= 0.75 ? null : 'Speak at a steady pace without long pauses.'),
    ),
  ];

  const weakest = [...dimensions]
    .filter((d) => d.score < 0.75)
    .sort((a, b) => a.score - b.score)[0];
  const modelAnswer = metadata.targetText
    ? `I can use ${metadata.targetText} in a clear sentence.`
    : transcript.trim() || null;

  return {
    overall: { level: level(scores.composite), headline, summary },
    nextFix: !transcript.trim()
      ? { title: 'Try again clearly', message: 'Say one complete English sentence, then stop recording.' }
      : weakest
        ? { title: `Fix ${weakest.dimension.toLowerCase()} next`, message: weakest.suggestion || weakest.message }
        : { title: 'Keep the same quality', message: 'Try another sentence with the same clear flow.' },
    modelAnswer,
    nextAction: !transcript.trim() ? 'try_again' : weakest ? 'shadow_model' : 'move_on',
    strengths: dimensions.filter((d) => d.score >= 0.75),
    weaknesses: dimensions.filter((d) => d.score < 0.75 && d.score > 0),
    diff: null,
  };
}

export function scoreFreeSpeak(input: FreeSpeakScoreInput): { scores: ScoreBreakdown; feedback: FullFeedback; metadata: FreeSpeakMetadata } {
  const transcript = (input.transcript ?? '').trim();
  const targetText = typeof input.targetText === 'string' && input.targetText.trim()
    ? input.targetText.trim()
    : null;
  const targetRequired = input.requireTargetText === true && targetText !== null;
  const targetUseScore = round3(targetRequired ? scoreTargetUse(transcript, targetText) : 1);
  const duration = Math.max(0, input.audioDurationSeconds);
  const metrics = input.fluencyMetrics ?? computeFluencyMetrics({
    transcript,
    audioDurationSeconds: duration,
    cefrBand: input.cefrBand,
  });
  const wordCount = metrics.wordCount || countWords(transcript);
  const measuredFluency = round3(metrics.fluencyIndex);
  const sentenceScore = round3(sentenceSufficiency(wordCount, duration || metrics.audioDurationSeconds));
  const offlineContent = round3(scoreContentQuality(transcript));
  const ai = normalizeAiGrade(input.aiGrade);
  const aiCoherence = ai.coherence;
  const contentScore = round3(ai.aiAvailable && aiCoherence !== null
    ? Math.min(offlineContent, aiCoherence)
    : offlineContent);

  let capApplied = 1;
  if (targetRequired && targetUseScore < 1) capApplied = Math.min(capApplied, 0.45);
  if (wordCount <= 1) capApplied = Math.min(capApplied, 0.35);
  else if (wordCount < 3) capApplied = Math.min(capApplied, 0.55);
  if (contentScore < 0.35) capApplied = Math.min(capApplied, 0.45);
  if (contentScore < 0.5) capApplied = Math.min(capApplied, 0.55);
  if (measuredFluency < 0.2) capApplied = Math.min(capApplied, 0.45);
  else if (measuredFluency < 0.35) capApplied = Math.min(capApplied, 0.6);

  const provisional = !ai.aiAvailable;
  let warning: string | null = null;
  if (provisional) {
    capApplied = Math.min(capApplied, 0.72);
    warning = 'AI content grading is unavailable. Ask an admin to configure a local model or API key in AI Settings.';
  }

  const performance = targetRequired
    ? clamp01(targetUseScore * 0.35 + contentScore * 0.35 + measuredFluency * 0.2 + sentenceScore * 0.1)
    : clamp01(contentScore * 0.6 + measuredFluency * 0.25 + sentenceScore * 0.15);
  const consistency = scoreConsistency(
    performance,
    input.bestPreviousScore ?? 0,
    input.latestPreviousScore ?? 0,
    input.previousAttemptCount ?? 0,
  );
  const compositeBeforeCap = (input.previousAttemptCount ?? 0) > 0
    ? performance * 0.9 + consistency * 0.1
    : performance;
  const composite = round3(Math.min(compositeBeforeCap, capApplied));

  const scores: ScoreBreakdown = {
    targetMatch: targetRequired ? targetUseScore : contentScore,
    pronunciation: 0,
    fluency: measuredFluency,
    completeness: sentenceScore,
    consistency: round3(consistency),
    composite,
  };

  const metadata: FreeSpeakMetadata = {
    mode: 'free-speak',
    targetText,
    targetRequired,
    targetUseScore,
    wordCount,
    contentScore,
    sentenceScore,
    measuredFluency,
    offlineContentScore: offlineContent,
    aiCoherence,
    aiReason: ai.reason,
    aiFluencyComment: ai.fluencyComment,
    aiAvailable: ai.aiAvailable,
    provider: ai.provider,
    model: ai.model,
    provisional,
    capApplied,
    warning,
  };

  return { scores, metadata, feedback: buildFeedback(scores, transcript, metadata) };
}

export function pronunciationWeakWordsFromAzureWords(
  words: WordScore[],
  stage: string,
  capturedAt = new Date().toISOString(),
): PronunciationWeakWordEvidence[] {
  return words
    .filter((word) => word.errorType === 'Mispronunciation' || word.errorType === 'Omission' || word.accuracy < 75)
    .map((word) => ({
      word: word.word,
      accuracy: Math.round(word.accuracy),
      errorType: word.errorType,
      weakPhonemes: word.phonemes
        .filter((phoneme) => phoneme.accuracy < 75)
        .map((phoneme) => ({ phoneme: phoneme.phoneme, accuracy: Math.round(phoneme.accuracy) })),
      stage,
      capturedAt,
    }));
}
