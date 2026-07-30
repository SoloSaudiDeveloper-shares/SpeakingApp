import { cookies } from 'next/headers';
import { getSessionFromToken } from '@/lib/actions/auth-actions';
import { analyzeAudio, hasRealSpeech, isLikelyHallucination } from '@/lib/speech/audio-analysis';
import { calculateScore, type CefrBand } from '@/lib/scoring/score-calculator';
import { generateFeedback } from '@/lib/scoring/feedback';
import { assessFromAzureResponse } from '@/lib/scoring/azure-pronunciation';
import { suggestCefrFromSamples } from '@/lib/actions/onboarding-actions';
import { computeFluencyMetrics, monologueSufficiency, scoreContentQuality } from '@/lib/scoring';
import { getTranscriptionConfig, getPronunciationConfig } from '@/lib/ai/providers';

/**
 * GET /api/dev/test-pipeline  (admin only)
 *
 * Automated regression harness for the speech → scoring → feedback pipeline.
 * Catches the classes of bug we kept hitting:
 *   1. Silent/empty audio must be detected as silence (never hallucinated).
 *   2. No-speech / punctuation-only transcripts score zero on EVERY dimension.
 *   3. Feedback must never contradict itself (no "you hesitated" under strengths).
 *   4. Correct answers score high; wrong answers score low.
 */

// ── synthetic audio generators ──────────────────────────────────────────────
function silence(seconds: number, sr = 16000): Float32Array {
  return new Float32Array(Math.round(seconds * sr))
}
function lowNoise(seconds: number, amp = 0.002, sr = 16000): Float32Array {
  const n = Math.round(seconds * sr); const b = new Float32Array(n)
  let seed = 7
  for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; b[i] = (seed / 0x7fffffff - 0.5) * 2 * amp }
  return b
}
function tone(seconds: number, freq = 200, amp = 0.2, sr = 16000): Float32Array {
  const n = Math.round(seconds * sr); const b = new Float32Array(n)
  for (let i = 0; i < n; i++) b[i] = Math.sin((2 * Math.PI * freq * i) / sr) * amp
  return b
}

interface Check { name: string; pass: boolean; detail: string }

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session-token')?.value;
  if (!token) return Response.json({ error: 'Not authenticated.' }, { status: 401 });
  const user = await getSessionFromToken(token);
  if (!user || user.role !== 'Admin') return Response.json({ error: 'Admin only.' }, { status: 403 });

  const checks: Check[] = [];
  const expect = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  // ── 1) Silence detection ──────────────────────────────────────────────────
  const audioCases: { name: string; buf: Float32Array; silent: boolean }[] = [
    { name: 'empty (0s)',        buf: silence(0),       silent: true },
    { name: 'silence 1s',        buf: silence(1),       silent: true },
    { name: 'low noise 1s',      buf: lowNoise(1),      silent: true },
    { name: 'too short 0.1s',    buf: tone(0.1),        silent: true },
    { name: 'tone 1s (speech-ish)', buf: tone(1),       silent: false },
    { name: 'loud tone 0.5s',    buf: tone(0.5, 180, 0.3), silent: false },
  ];
  for (const c of audioCases) {
    const stats = analyzeAudio(c.buf, 16000);
    expect(`audio: ${c.name}`, stats.isSilent === c.silent,
      `isSilent=${stats.isSilent} (want ${c.silent}) rms=${stats.rms.toFixed(4)} peak=${stats.peak.toFixed(3)} voiced=${stats.voicedFraction.toFixed(2)}`);
  }

  // ── 1b) Shared transcript gate (used by BOTH Whisper engines) ─────────────
  // These two helpers now live in audio-analysis.ts so cloud + offline Whisper
  // apply IDENTICAL rules. Lock the behaviour the engines depend on.
  expect('gate: hasRealSpeech rejects "."',   !hasRealSpeech('.'),   `got ${hasRealSpeech('.')}`);
  expect('gate: hasRealSpeech rejects "..."', !hasRealSpeech('...'), `got ${hasRealSpeech('...')}`);
  expect('gate: hasRealSpeech rejects "  "',  !hasRealSpeech('  '),  `got ${hasRealSpeech('  ')}`);
  expect('gate: hasRealSpeech accepts "yes"',  hasRealSpeech('yes'), `got ${hasRealSpeech('yes')}`);
  expect('gate: hasRealSpeech accepts "no"',   hasRealSpeech('no'),  `got ${hasRealSpeech('no')}`);
  // Hallucination only fires for known phrases AND quiet audio (rms below ceiling).
  expect('gate: "thank you" @ quiet rms → hallucination', isLikelyHallucination('thank you', 0.008), 'expected true');
  expect('gate: "you" @ quiet rms → hallucination',       isLikelyHallucination('you', 0.01),        'expected true');
  expect('gate: "thank you" @ speech rms → NOT flagged', !isLikelyHallucination('thank you', 0.08),  'expected false (loud enough to be real)');
  expect('gate: real word "pen" never flagged',          !isLikelyHallucination('pen', 0.005),       'expected false (not a known hallucination)');
  expect('gate: real answer "yes" never flagged',        !isLikelyHallucination('yes', 0.005),       'expected false');

  // ── 2/3/4) Scoring + feedback ──────────────────────────────────────────────
  const NEG = /hesitat|slow|off|fast|rush/i;
  const scoreCases: { name: string; transcript: string; expected: string[]; dur: number; cefr?: CefrBand;
    wantZero?: boolean; wantHighComposite?: boolean; wantLowComposite?: boolean }[] = [
    { name: 'empty',            transcript: '',                 expected: ['pen'], dur: 3, wantZero: true },
    { name: 'silence dot',      transcript: '.',                expected: ['pen'], dur: 3, wantZero: true },
    { name: 'hallucination',    transcript: 'thank you',        expected: ['pen'], dur: 3, wantLowComposite: true },
    { name: 'correct word',     transcript: 'pen',              expected: ['pen'], dur: 1, wantHighComposite: true },
    { name: 'wrong word',       transcript: 'window',           expected: ['pen'], dur: 1, wantLowComposite: true },
    { name: 'correct sentence', transcript: 'i write with a pen', expected: ['i write with a pen'], dur: 1.8, wantHighComposite: true },
    { name: 'hesitant correct', transcript: 'pen',              expected: ['pen'], dur: 4, wantHighComposite: true },
  ];

  for (const c of scoreCases) {
    const breakdown = calculateScore({
      transcript: c.transcript, expectedAnswersJson: JSON.stringify(c.expected),
      spokenPhonemes: null, referencePhonemes: null, audioDurationSeconds: c.dur,
      bestPreviousScore: 0, latestPreviousScore: 0, previousAttemptCount: 0, cefrBand: c.cefr ?? 'A1',
    });
    const fb = generateFeedback(breakdown, c.transcript, c.expected, c.dur);

    if (c.wantZero) {
      const allZero = breakdown.composite === 0 && breakdown.fluency === 0 && breakdown.pronunciation === 0;
      expect(`score: ${c.name} → all zero`, allZero, `composite=${breakdown.composite} fluency=${breakdown.fluency}`);
    }
    if (c.wantHighComposite) {
      expect(`score: ${c.name} → high`, breakdown.composite >= 0.7, `composite=${breakdown.composite.toFixed(2)}`);
    }
    if (c.wantLowComposite) {
      expect(`score: ${c.name} → low`, breakdown.composite < 0.4, `composite=${breakdown.composite.toFixed(2)}`);
    }
    // Feedback must never put a negative-sounding message under "strengths".
    const badStrength = fb.strengths.find((s) => NEG.test(s.message));
    expect(`feedback: ${c.name} → no self-contradiction`, !badStrength,
      badStrength ? `strength "${badStrength.dimension}" says "${badStrength.message}"` : 'ok');
  }

  // ── 5) Azure pronunciation mapping ─────────────────────────────────────────
  // Real Azure API shape: scores flattened directly onto utterance/word/phoneme.
  const azureGood = {
    RecognitionStatus: 'Success', DisplayText: 'Pen.',
    NBest: [{
      Display: 'Pen.', AccuracyScore: 92, FluencyScore: 95, CompletenessScore: 100, PronScore: 93, ProsodyScore: 88,
      Words: [{ Word: 'pen', AccuracyScore: 92, ErrorType: 'None',
        Phonemes: [
          { Phoneme: 'p', AccuracyScore: 98 },
          { Phoneme: 'eh', AccuracyScore: 85 },
          { Phoneme: 'n', AccuracyScore: 95 },
        ] }],
    }],
  };
  const aGood = assessFromAzureResponse(azureGood, 'A1', 0.5);
  expect('azure: good (flattened) → mapped high', !!aGood && aGood.breakdown.pronunciation > 0.85 && aGood.breakdown.composite > 0.8 && aGood.words[0]?.phonemes.length === 3,
    aGood ? `pron=${aGood.breakdown.pronunciation} composite=${aGood.breakdown.composite.toFixed(2)} phonemes=${aGood.words[0]?.phonemes.length}` : 'null');

  const azureBad = {
    RecognitionStatus: 'Success', DisplayText: 'Ben.',
    NBest: [{
      Display: 'Ben.', AccuracyScore: 45, FluencyScore: 60, CompletenessScore: 100, PronScore: 48, ProsodyScore: 50,
      Words: [{ Word: 'pen', AccuracyScore: 45, ErrorType: 'Mispronunciation',
        Phonemes: [
          { Phoneme: 'p', AccuracyScore: 40 },
          { Phoneme: 'eh', AccuracyScore: 55 },
          { Phoneme: 'n', AccuracyScore: 50 },
        ] }],
    }],
  };
  const aBad = assessFromAzureResponse(azureBad, 'A1', 0.5);
  expect('azure: mispronounced → low + flagged', !!aBad && aBad.breakdown.pronunciation < 0.6 && aBad.words[0]?.errorType === 'Mispronunciation',
    aBad ? `pron=${aBad.breakdown.pronunciation} err=${aBad.words[0]?.errorType}` : 'null');

  const aNone = assessFromAzureResponse({ RecognitionStatus: 'NoMatch' }, 'A1', 0.5);
  expect('azure: no-match → null (→ NO_SPEECH, no fake score)', aNone === null, aNone === null ? 'ok' : 'expected null');

  // Said nothing / wrong word → reference word omitted → must score ~0 (not a
  // fake perfect "you said red"). This is the bug the user hit.
  const azureOmitted = {
    RecognitionStatus: 'Success', DisplayText: '',
    NBest: [{ Display: '', AccuracyScore: 0, FluencyScore: 0, CompletenessScore: 0, PronScore: 0,
      Words: [{ Word: 'red', AccuracyScore: 0, ErrorType: 'Omission', Phonemes: [] }] }],
  };
  const aOmit = assessFromAzureResponse(azureOmitted, 'A1', 0.5);
  expect('azure: omitted/unsaid word → ~0 (no fake score)', !!aOmit && aOmit.breakdown.targetMatch === 0 && aOmit.breakdown.composite < 0.1,
    aOmit ? `target=${aOmit.breakdown.targetMatch} composite=${aOmit.breakdown.composite.toFixed(2)}` : 'null');

  // ── 5b) Diagnostic CEFR estimate (fluency axis + optional Azure pron axis) ──
  // Backward compatible: with no Azure `pron` on samples it's the old heuristic.
  const dxFluencyOnly = suggestCefrFromSamples([
    { transcript: 'a', fluencyIndex: 0.8, speechRateWpm: 130 },
    { transcript: 'b', fluencyIndex: 0.8, speechRateWpm: 130 },
  ]);
  expect('diagnostic: no Azure → fluency-only B2', dxFluencyOnly.suggestedCefr === 'B2' && dxFluencyOnly.pronAvg === null,
    `band=${dxFluencyOnly.suggestedCefr} pronAvg=${dxFluencyOnly.pronAvg}`);

  const dxLowAll = suggestCefrFromSamples([{ transcript: 'a', fluencyIndex: 0.2, speechRateWpm: 40 }]);
  expect('diagnostic: low fluency, no Azure → A1', dxLowAll.suggestedCefr === 'A1', `band=${dxLowAll.suggestedCefr}`);

  // Strong pronunciation but weak spontaneous fluency → blended UP, but not all
  // the way (a clean read of simple sentences must not place a non-fluent
  // speaker at B2). A1(0) fluency + B2(3) pron → round(0·0.55 + 3·0.45)=1 → A2.
  const dxHighPron = suggestCefrFromSamples([
    { transcript: 'a', fluencyIndex: 0.2, speechRateWpm: 40, pron: 0.92, byAzure: true },
    { transcript: 'b', fluencyIndex: 0.2, speechRateWpm: 40, pron: 0.92, byAzure: true },
  ]);
  expect('diagnostic: high pron + low fluency → blended to A2', dxHighPron.suggestedCefr === 'A2' && dxHighPron.pronAvg !== null,
    `band=${dxHighPron.suggestedCefr} pronAvg=${dxHighPron.pronAvg}`);

  // Fluent but poor pronunciation → blended DOWN. B2(3) fluency + A1(0) pron →
  // round(3·0.55 + 0·0.45)=round(1.65)=2 → B1.
  const dxPoorPron = suggestCefrFromSamples([
    { transcript: 'a', fluencyIndex: 0.8, speechRateWpm: 130, pron: 0.25, byAzure: true },
  ]);
  expect('diagnostic: high fluency + poor pron → blended to B1', dxPoorPron.suggestedCefr === 'B1',
    `band=${dxPoorPron.suggestedCefr}`);

  // Both axes strong → B2.
  const dxBoth = suggestCefrFromSamples([
    { transcript: 'a', fluencyIndex: 0.8, speechRateWpm: 130, pron: 0.9, byAzure: true },
  ]);
  expect('diagnostic: strong fluency + strong pron → B2', dxBoth.suggestedCefr === 'B2', `band=${dxBoth.suggestedCefr}`);

  // ── 5c) Monologue sustained-speech guard ("yo yo" must NOT score fluent) ────
  // The bug: a 2-word burst over ~1s computes to ~90 wpm → high raw fluency.
  // The sufficiency floor must scale that right down.
  const yoyoMetrics = computeFluencyMetrics({ transcript: 'yo yo', audioDurationSeconds: 1.3, pauseEvents: [], cefrBand: 'A1' });
  const yoyoSuff = monologueSufficiency(yoyoMetrics.wordCount, yoyoMetrics.audioDurationSeconds);
  const yoyoAdjusted = yoyoMetrics.fluencyIndex * yoyoSuff;
  expect('monologue: "yo yo" sufficiency is low', yoyoSuff <= 0.35, `sufficiency=${yoyoSuff.toFixed(2)} (rawFluency=${yoyoMetrics.fluencyIndex})`);
  expect('monologue: "yo yo" adjusted fluency < 0.35', yoyoAdjusted < 0.35, `adjusted=${yoyoAdjusted.toFixed(2)} (was ${yoyoMetrics.fluencyIndex})`);

  // A real, sustained monologue keeps full credit.
  const realText = 'i usually wake up early and have a good breakfast before i go to work every single morning';
  const realMetrics = computeFluencyMetrics({ transcript: realText, audioDurationSeconds: 22, pauseEvents: [], cefrBand: 'A1' });
  const realSuff = monologueSufficiency(realMetrics.wordCount, realMetrics.audioDurationSeconds);
  expect('monologue: full monologue keeps full credit', realSuff === 1, `sufficiency=${realSuff} words=${realMetrics.wordCount}`);
  expect('monologue: empty → 0 sufficiency', monologueSufficiency(0, 0) === 0, 'expected 0');

  // Content quality: sustained nonsense ("yo yo yo…") must score near-zero even
  // though its speech RATE is fine; real varied speech keeps full credit.
  const cqYoyo = scoreContentQuality('yo yo yo yo yo yo yo yo yo yo yo yo');
  expect('content: "yo yo…" → near zero', cqYoyo < 0.3, `content=${cqYoyo.toFixed(2)}`);
  const cqReal = scoreContentQuality(realText);
  expect('content: real monologue → high', cqReal >= 0.9, `content=${cqReal.toFixed(2)}`);
  expect('content: empty → 0', scoreContentQuality('') === 0, 'expected 0');
  // A normal sentence that repeats common function words is NOT penalised.
  const cqNormal = scoreContentQuality('i think the weather is nice and i like to walk in the park');
  expect('content: normal speech not penalised', cqNormal >= 0.9, `content=${cqNormal.toFixed(2)}`);
  // Length-robust: a SHORT legit answer (practice free-speak) keeps full credit…
  const cqShort = scoreContentQuality('i use a pen to write letters');
  expect('content: short legit sentence not penalised', cqShort >= 0.9, `content=${cqShort.toFixed(2)}`);
  // …but sustained single-word repetition is caught regardless of length.
  const cqThe = scoreContentQuality('the the the the the the');
  expect('content: "the the the…" → near zero', cqThe < 0.3, `content=${cqThe.toFixed(2)}`);
  // Under 4 words is deferred to the sufficiency floor, not docked here.
  expect('content: <4 words deferred to sufficiency', scoreContentQuality('yo yo') === 1, 'expected 1');

  // ── 6) Both engines configured (the default: Groq STT + Azure pronunciation) ─
  const sttCfg = await getTranscriptionConfig();
  const pronCfg = await getPronunciationConfig();
  expect('engines: Groq speech-to-text key set', !!sttCfg.apiKey, sttCfg.apiKey ? `model=${sttCfg.model}` : 'no Groq key');
  expect('engines: Azure pronunciation key set', !!pronCfg.apiKey, pronCfg.apiKey ? `region=${pronCfg.region}` : 'no Azure key');

  const failures = checks.filter((c) => !c.pass);
  return Response.json({
    passed: failures.length === 0,
    total: checks.length,
    failed: failures.length,
    failures,
    checks,
  });
}
