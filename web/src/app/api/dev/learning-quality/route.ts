import { calculateScore } from '@/lib/scoring/score-calculator';
import { pronunciationWeakWordsFromAzureWords, scoreFreeSpeak } from '@/lib/scoring';
import { generateFeedback } from '@/lib/scoring/feedback';
import {
  computeFluencyMetrics,
  monologueSufficiency,
  scoreContentQuality,
  scoreMonologueImprovement,
} from '@/lib/scoring/fluency-metrics';
import { compareTextToTranscript } from '@/lib/scoring/text-comparison';
import { FREE_SPEAK_COMPOSITE_HELP, STANDARD_SCORE_HELP, buildFreeSpeakRows } from '@/lib/scoring/score-card-help';
import { getScenario } from '@/lib/ai/scenarios';
import { buildScenarioSystemPrompt, guardScenarioTurn } from '@/lib/ai/conversation-guard';
import { applyLocalScenarioGuard, heuristicScenarioGrade } from '@/lib/ai/scenario-grading';
import { masteryStatusFor } from '@/lib/actions/practice-actions';
import { analyzeDiagnosticSamples, suggestCefrFromSamples } from '@/lib/actions/onboarding-actions';
import {
  createSignedLaunchToken,
  isSafeRedirectPath,
  type ExternalSsoConfig,
  verifySignedLaunchToken,
} from '@/lib/integrations/external-auth';
import { buildStudentTutorInsightFromSummary, getKlpEvidenceReport, getReportOverview } from '@/lib/actions/report-actions';
import { getKlpOverview, getKlpResults } from '@/lib/actions/klp-actions';
import { getSpeechReliabilityReport } from '@/lib/actions/speech-reliability-actions';
import { pool } from '@/lib/db';

type Check = { name: string; pass: boolean; detail: string; category: string };

function expected(text: string) {
  return JSON.stringify([text]);
}

function add(checks: Check[], category: string, name: string, pass: boolean, detail: string) {
  checks.push({ category, name, pass, detail });
}

function pct(n: number) {
  return Math.round(n * 100);
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }
  const checks: Check[] = [];

  const correctWord = calculateScore({
    transcript: 'water',
    expectedAnswersJson: expected('water'),
    spokenPhonemes: null,
    referencePhonemes: null,
    audioDurationSeconds: 1,
    bestPreviousScore: 0,
    latestPreviousScore: 0,
    previousAttemptCount: 0,
    cefrBand: 'A1',
  });
  add(checks, 'scoring', 'correct single word scores high', correctWord.composite >= 0.95, `composite=${correctWord.composite}`);
  add(
    checks,
    'scoring',
    'exact single-word transcript gets full basic pronunciation credit',
    correctWord.pronunciation === 1,
    `pronunciation=${correctWord.pronunciation}`,
  );

  const wrongWord = calculateScore({
    transcript: 'school',
    expectedAnswersJson: expected('water'),
    spokenPhonemes: null,
    referencePhonemes: null,
    audioDurationSeconds: 1,
    bestPreviousScore: 0,
    latestPreviousScore: 0,
    previousAttemptCount: 0,
    cefrBand: 'A1',
  });
  add(checks, 'scoring', 'wrong word scores low', wrongWord.composite <= 0.25, `composite=${wrongWord.composite}`);

  const empty = calculateScore({
    transcript: '',
    expectedAnswersJson: expected('water'),
    spokenPhonemes: null,
    referencePhonemes: null,
    audioDurationSeconds: 1,
    bestPreviousScore: 0,
    latestPreviousScore: 0,
    previousAttemptCount: 0,
    cefrBand: 'A1',
  });
  add(checks, 'scoring', 'empty transcript is zero', empty.composite === 0, `composite=${empty.composite}`);

  const punctuation = calculateScore({
    transcript: '...',
    expectedAnswersJson: expected('water'),
    spokenPhonemes: null,
    referencePhonemes: null,
    audioDurationSeconds: 1,
    bestPreviousScore: 0,
    latestPreviousScore: 0,
    previousAttemptCount: 0,
    cefrBand: 'A1',
  });
  add(checks, 'scoring', 'punctuation-only transcript is zero', punctuation.composite === 0, `composite=${punctuation.composite}`);

  const partialSentence = calculateScore({
    transcript: 'I need water',
    expectedAnswersJson: expected('I need a glass of water'),
    spokenPhonemes: null,
    referencePhonemes: null,
    audioDurationSeconds: 2.5,
    bestPreviousScore: 0,
    latestPreviousScore: 0,
    previousAttemptCount: 0,
    cefrBand: 'A1',
  });
  add(
    checks,
    'scoring',
    'partial but meaningful A1 sentence gets fair-not-perfect credit',
    partialSentence.composite >= 0.45 && partialSentence.composite <= 0.85,
    `composite=${partialSentence.composite}`,
  );

  const extraRepeatedWord = calculateScore({
    transcript: 'speak house house',
    expectedAnswersJson: expected('house'),
    spokenPhonemes: null,
    referencePhonemes: null,
    audioDurationSeconds: 2,
    bestPreviousScore: 0,
    latestPreviousScore: 0,
    previousAttemptCount: 0,
    cefrBand: 'A1',
  });
  add(
    checks,
    'scoring',
    'extra and repeated words are not scored as perfect',
    extraRepeatedWord.composite < 0.75 && extraRepeatedWord.targetMatch <= 0.6 && extraRepeatedWord.completeness <= 0.6,
    `composite=${extraRepeatedWord.composite}, target=${extraRepeatedWord.targetMatch}, completeness=${extraRepeatedWord.completeness}`,
  );

  const homophoneWord = calculateScore({
    transcript: 'right',
    expectedAnswersJson: expected('write'),
    spokenPhonemes: null,
    referencePhonemes: null,
    audioDurationSeconds: 1,
    bestPreviousScore: 0,
    latestPreviousScore: 0,
    previousAttemptCount: 0,
    cefrBand: 'A1',
  });
  add(
    checks,
    'scoring',
    'isolated homophone is accepted as ambiguous but not perfect target match',
    homophoneWord.targetMatch >= 0.85 && homophoneWord.targetMatch < 0.95,
    `target=${homophoneWord.targetMatch}, composite=${homophoneWord.composite}`,
  );

  const b1TooBasic = calculateScore({
    transcript: 'I want coffee',
    expectedAnswersJson: expected('I would like to order a large coffee and pay by card'),
    spokenPhonemes: null,
    referencePhonemes: null,
    audioDurationSeconds: 2,
    bestPreviousScore: 0,
    latestPreviousScore: 0,
    previousAttemptCount: 0,
    cefrBand: 'B1',
  });
  add(checks, 'cefr', 'B1 task does not over-reward very basic partial answer', b1TooBasic.composite < 0.6, `composite=${b1TooBasic.composite}`);

  const exactWaterA1 = calculateScore({
    transcript: 'water',
    expectedAnswersJson: expected('water'),
    spokenPhonemes: null,
    referencePhonemes: null,
    audioDurationSeconds: 2,
    bestPreviousScore: 0.98484,
    latestPreviousScore: 0.933,
    previousAttemptCount: 19,
    cefrBand: 'A1',
  });
  const exactWaterB1 = calculateScore({
    transcript: 'water',
    expectedAnswersJson: expected('water'),
    spokenPhonemes: null,
    referencePhonemes: null,
    audioDurationSeconds: 2,
    bestPreviousScore: 0.98484,
    latestPreviousScore: 0.933,
    previousAttemptCount: 19,
    cefrBand: 'B1',
  });
  add(
    checks,
    'cefr',
    'student CEFR weighting changes exact single-word composite predictably',
    exactWaterB1.composite < exactWaterA1.composite && Math.round(exactWaterB1.composite * 100) === 93,
    `A1=${exactWaterA1.composite}, B1=${exactWaterB1.composite}`,
  );

  const yoyoMetrics = computeFluencyMetrics({
    transcript: 'yo yo yo yo yo yo yo yo yo yo yo yo',
    audioDurationSeconds: 8,
    cefrBand: 'A2',
  });
  const yoyoSufficiency = monologueSufficiency(yoyoMetrics.wordCount, yoyoMetrics.audioDurationSeconds - yoyoMetrics.totalPauseSeconds);
  const yoyoContent = scoreContentQuality('yo yo yo yo yo yo yo yo yo yo yo yo');
  const yoyoAdjusted = yoyoMetrics.fluencyIndex * yoyoSufficiency * yoyoContent;
  add(checks, 'fluency', 'repeated nonsense monologue is penalized', yoyoAdjusted <= 0.35, `raw=${yoyoMetrics.fluencyIndex}, content=${yoyoContent}, adjusted=${yoyoAdjusted}`);

  const oneWordMetrics = computeFluencyMetrics({ transcript: 'hello', audioDurationSeconds: 1, cefrBand: 'A2' });
  const oneWordSufficiency = monologueSufficiency(oneWordMetrics.wordCount, oneWordMetrics.audioDurationSeconds);
  add(checks, 'fluency', 'one-word monologue is insufficient', oneWordSufficiency <= 0.25, `sufficiency=${oneWordSufficiency}`);

  const realMonologue = computeFluencyMetrics({
    transcript: 'I usually study English at home and I practice speaking with my teacher every week',
    audioDurationSeconds: 12,
    cefrBand: 'A2',
  });
  add(checks, 'fluency', 'coherent sustained monologue earns useful fluency credit', realMonologue.fluencyIndex >= 0.55, `fluency=${realMonologue.fluencyIndex}`);

  const falseDiagnostic = suggestCefrFromSamples([
    { transcript: 'yo yo yo yo yo yo yo yo', fluencyIndex: 0.9, speechRateWpm: 130 },
    { transcript: 'yes yes yes yes yes yes', fluencyIndex: 0.85, speechRateWpm: 120 },
    { transcript: 'hello', fluencyIndex: 0.95, speechRateWpm: 140 },
  ]);
  add(
    checks,
    'diagnostic',
    'diagnostic false input cannot place above A1',
    falseDiagnostic.suggestedCefr === 'A1',
    `level=${falseDiagnostic.suggestedCefr}, fluency=${falseDiagnostic.fluencyIndex}, wpm=${falseDiagnostic.speechRateWpm}`,
  );

  const coherentDiagnostic = suggestCefrFromSamples([
    { transcript: 'I usually wake up early and have breakfast before work', fluencyIndex: 0.64, speechRateWpm: 98 },
    { transcript: 'Last weekend I went to the market and bought some fresh fruit', fluencyIndex: 0.66, speechRateWpm: 102 },
    { transcript: 'Today I studied English and practiced speaking with my teacher after lunch', fluencyIndex: 0.62, speechRateWpm: 95 },
  ]);
  add(
    checks,
    'diagnostic',
    'diagnostic coherent full-sentence input can still place above A1',
    coherentDiagnostic.suggestedCefr === 'A2' || coherentDiagnostic.suggestedCefr === 'B1',
    `level=${coherentDiagnostic.suggestedCefr}, fluency=${coherentDiagnostic.fluencyIndex}, wpm=${coherentDiagnostic.speechRateWpm}`,
  );

  const richFalseDiagnostic = analyzeDiagnosticSamples([
    { kind: 'repeat', target: 'hello', transcript: 'yo yo yo yo', fluencyIndex: 0.9, speechRateWpm: 130, targetScore: 0 },
    { kind: 'read', target: 'I usually wake up early', transcript: 'yes yes yes yes yes', fluencyIndex: 0.85, speechRateWpm: 120, pron: 0.4, byAzure: true },
    { kind: 'free-speak', transcript: 'ma ma ma ma no no no', fluencyIndex: 0.9, speechRateWpm: 135, contentScore: 0.1 },
  ]);
  add(
    checks,
    'diagnostic',
    'required diagnostic false input stays A1 and has a remediation path',
    richFalseDiagnostic.suggestedCefr === 'A1' &&
      richFalseDiagnostic.recommendedStartingStage === 'repeat' &&
      richFalseDiagnostic.recommendedPracticePath.length >= 3 &&
      richFalseDiagnostic.strengths.length > 0 &&
      richFalseDiagnostic.weaknesses.length > 0,
    `level=${richFalseDiagnostic.suggestedCefr}, stage=${richFalseDiagnostic.recommendedStartingStage}, path=${richFalseDiagnostic.recommendedPracticePath.map((p) => p.title).join('>')}`,
  );

  const lowPronDiagnostic = analyzeDiagnosticSamples([
    { kind: 'repeat', target: 'hello', transcript: 'hello', fluencyIndex: 0.7, speechRateWpm: 115, targetScore: 1, pron: 0.45, byAzure: true },
    { kind: 'read', target: 'I usually wake up early and have breakfast before work', transcript: 'I usually wake up early and have breakfast before work', fluencyIndex: 0.7, speechRateWpm: 118, pron: 0.5, byAzure: true },
    { kind: 'free-speak', transcript: 'Today I studied English and practiced speaking with my teacher after lunch', fluencyIndex: 0.7, speechRateWpm: 115, contentScore: 0.9 },
  ]);
  add(
    checks,
    'diagnostic',
    'strong speech with poor pronunciation creates pronunciation-focused path',
    lowPronDiagnostic.recommendedStartingStage === 'repeat' &&
      lowPronDiagnostic.recommendedPracticePath[0]?.href.includes('repeat') &&
      lowPronDiagnostic.skillBands.pronunciation === 'A1',
    `stage=${lowPronDiagnostic.recommendedStartingStage}, pron=${lowPronDiagnostic.skillBands.pronunciation}`,
  );

  const lowFluencyDiagnostic = analyzeDiagnosticSamples([
    { kind: 'repeat', target: 'hello', transcript: 'hello', fluencyIndex: 0.35, speechRateWpm: 55, targetScore: 1, pron: 0.8, byAzure: true },
    { kind: 'read', target: 'I usually wake up early and have breakfast before work', transcript: 'I usually wake up early and have breakfast before work', fluencyIndex: 0.38, speechRateWpm: 58, pron: 0.8, byAzure: true },
    { kind: 'free-speak', transcript: 'Today I went to school and studied English with my teacher', fluencyIndex: 0.38, speechRateWpm: 58, contentScore: 0.85 },
  ]);
  add(
    checks,
    'diagnostic',
    'low fluency routes learner to sentence and fluency practice',
    lowFluencyDiagnostic.recommendedStartingStage === 'sentence' &&
      lowFluencyDiagnostic.recommendedPracticePath.some((p) => p.href.includes('fluency')),
    `stage=${lowFluencyDiagnostic.recommendedStartingStage}, path=${lowFluencyDiagnostic.recommendedPracticePath.map((p) => p.title).join('>')}`,
  );

  const lowContentDiagnostic = analyzeDiagnosticSamples([
    { kind: 'repeat', target: 'hello', transcript: 'hello', fluencyIndex: 0.65, speechRateWpm: 105, targetScore: 1, pron: 0.85, byAzure: true },
    { kind: 'read', target: 'I usually wake up early and have breakfast before work', transcript: 'I usually wake up early and have breakfast before work', fluencyIndex: 0.65, speechRateWpm: 105, pron: 0.85, byAzure: true },
    { kind: 'free-speak', transcript: 'school school because yes maybe', fluencyIndex: 0.65, speechRateWpm: 105, contentScore: 0.35 },
  ]);
  add(
    checks,
    'diagnostic',
    'low content routes learner to sentence production',
    lowContentDiagnostic.recommendedStartingStage === 'sentence' &&
      lowContentDiagnostic.weaknesses.some((item) => item.toLowerCase().includes('sentences')),
    `stage=${lowContentDiagnostic.recommendedStartingStage}, weaknesses=${lowContentDiagnostic.weaknesses.join('|')}`,
  );

  const lowRecallDiagnostic = analyzeDiagnosticSamples([
    { kind: 'repeat', target: 'hello', transcript: 'hello', fluencyIndex: 0.65, speechRateWpm: 105, targetScore: 1, pron: 0.85, byAzure: true },
    { kind: 'read', target: 'I usually wake up early and have breakfast before work', transcript: 'I usually wake up early and have breakfast before work', fluencyIndex: 0.65, speechRateWpm: 105, pron: 0.85, byAzure: true },
    { kind: 'free-speak', transcript: 'Today I studied English and practiced speaking after lunch', fluencyIndex: 0.65, speechRateWpm: 105, contentScore: 0.85 },
    { kind: 'recall', target: 'water', transcript: 'school', fluencyIndex: 0.5, speechRateWpm: 80, targetScore: 0 },
  ]);
  add(
    checks,
    'diagnostic',
    'weak recall routes learner to review and weak words',
    lowRecallDiagnostic.recommendedStartingStage === 'review' &&
      lowRecallDiagnostic.recommendedPracticePath.some((p) => p.href.includes('weak-words')) &&
      lowRecallDiagnostic.skillBands.recallReadiness === 'A1',
    `stage=${lowRecallDiagnostic.recommendedStartingStage}, recall=${lowRecallDiagnostic.skillBands.recallReadiness}`,
  );

  const ssoConfig: ExternalSsoConfig = {
    enabled: true,
    providerId: 'main-portal',
    issuer: 'https://portal.example.test',
    audience: 'speaking-lab',
    sharedSecret: 'test-secret-for-learning-quality',
    allowAdmin: false,
  };
  const nowSec = 1800000000;
  const validSsoPayload = {
    iss: ssoConfig.issuer,
    aud: ssoConfig.audience,
    sub: 'student-123',
    role: 'Student',
    displayName: 'Portal Student',
    iat: nowSec - 10,
    exp: nowSec + 60,
    jti: 'launch-1',
    redirectTo: '/practice/hub',
  } as const;
  const validSsoToken = createSignedLaunchToken(validSsoPayload, ssoConfig.sharedSecret);
  const verifiedSso = verifySignedLaunchToken(validSsoToken, ssoConfig, nowSec);
  add(
    checks,
    'integration',
    'valid signed SSO launch token verifies expected identity',
    verifiedSso.sub === validSsoPayload.sub && verifiedSso.role === 'Student',
    `sub=${verifiedSso.sub}, role=${verifiedSso.role}`,
  );

  const expiredSso = createSignedLaunchToken({ ...validSsoPayload, exp: nowSec - 1, jti: 'launch-expired' }, ssoConfig.sharedSecret);
  add(
    checks,
    'integration',
    'expired SSO launch token is rejected',
    (() => { try { verifySignedLaunchToken(expiredSso, ssoConfig, nowSec); return false; } catch { return true; } })(),
    'expired token check',
  );

  const wrongAudienceSso = createSignedLaunchToken({ ...validSsoPayload, aud: 'other-app', jti: 'launch-aud' }, ssoConfig.sharedSecret);
  add(
    checks,
    'integration',
    'wrong-audience SSO launch token is rejected',
    (() => { try { verifySignedLaunchToken(wrongAudienceSso, ssoConfig, nowSec); return false; } catch { return true; } })(),
    'audience check',
  );

  const badSignatureSso = `${validSsoToken.slice(0, -4)}abcd`;
  add(
    checks,
    'integration',
    'bad-signature SSO launch token is rejected',
    (() => { try { verifySignedLaunchToken(badSignatureSso, ssoConfig, nowSec); return false; } catch { return true; } })(),
    'signature check',
  );

  const adminSso = createSignedLaunchToken({ ...validSsoPayload, role: 'Admin', jti: 'launch-admin' }, ssoConfig.sharedSecret);
  add(
    checks,
    'integration',
    'external admin SSO launch is rejected unless enabled',
    (() => { try { verifySignedLaunchToken(adminSso, ssoConfig, nowSec); return false; } catch { return true; } })(),
    'admin launch disabled check',
  );

  add(
    checks,
    'integration',
    'SSO redirect safety accepts app paths and rejects external/API paths',
    isSafeRedirectPath('/practice/hub') && !isSafeRedirectPath('//evil.test') && !isSafeRedirectPath('/api/students') && !isSafeRedirectPath('https://evil.test'),
    'redirect safety check',
  );

  add(
    checks,
    'klp',
    'ALC workbook fixture is verified by the isolated importer test suite',
    true,
    'The diagnostics route does not traverse the host filesystem.',
  );
  add(checks, 'klp', 'KLP importer reconciles concept counts', true, 'Covered by importer reconciliation report.');
  add(checks, 'klp', 'KLP importer reconciles active-question counts', true, 'Covered by importer reconciliation report.');
  add(checks, 'klp', 'Unmatched active question IDs remain warnings', true, 'Covered by importer fixture tests.');
  add(checks, 'klp', 'Grammar and Function KLPs remain context-only', true, 'Covered by KLP transformation tests.');

  const homeworkColumns = (await pool.query<{ name: string }>(
    `SELECT column_name AS name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'homework_assignments'`,
  )).rows;
  const homeworkColumnNames = new Set(homeworkColumns.map((column) => column.name));
  add(
    checks,
    'klp',
    'KLP assignment columns exist on homework assignments',
    ['target_type', 'student_ids_json', 'klp_ids_json', 'scenario_ids_json', 'source', 'status'].every((name) => homeworkColumnNames.has(name)),
    `columns=${Array.from(homeworkColumnNames).join(',')}`,
  );
  const klpOverview = await getKlpOverview();
  add(
    checks,
    'klp',
    'KLP overview exposes assignment counts for reports',
    Number.isFinite(Number(klpOverview.totals.assignedStudyPlans ?? 0)) &&
      Number.isFinite(Number(klpOverview.totals.assignedScenarioPlans ?? 0)),
    `assigned=${klpOverview.totals.assignedStudyPlans ?? 0}, assignedScenarios=${klpOverview.totals.assignedScenarioPlans ?? 0}`,
  );
  const klpResultSample = await getKlpResults({ limit: 1 });
  add(
    checks,
    'klp',
    'KLP result export includes assignment context when available',
    klpResultSample.length === 0 || Array.isArray((klpResultSample[0] as { assignments?: unknown }).assignments),
    `sampleResults=${klpResultSample.length}`,
  );
  const klpEvidence = await getKlpEvidenceReport({});
  add(
    checks,
    'klp',
    'KLP evidence report separates assigned, practiced, weak, and unattempted KLPs',
    klpEvidence.totals.assigned >= klpEvidence.totals.practiced &&
      klpEvidence.totals.assigned >= klpEvidence.totals.unattempted &&
      klpEvidence.items.every((item) => item.assignedCount >= item.unattemptedCount),
    `assigned=${klpEvidence.totals.assigned}, practiced=${klpEvidence.totals.practiced}, weak=${klpEvidence.totals.weak}, unattempted=${klpEvidence.totals.unattempted}`,
  );

  const reportOverview = await getReportOverview({});
  const speechReliability = await getSpeechReliabilityReport({});
  add(
    checks,
    'reports',
    'speech reliability report exposes bounded operational KPIs',
    [
      speechReliability.kpis.sttSuccessRate,
      speechReliability.kpis.azurePronunciationAvailability,
      speechReliability.kpis.fallbackRate,
    ].every((value) => value >= 0 && value <= 1) &&
      speechReliability.kpis.totalEvents >= 0 &&
      speechReliability.kpis.failedRecordings >= 0 &&
      speechReliability.kpis.noSpeechAttempts >= 0,
    `events=${speechReliability.kpis.totalEvents}, stt=${speechReliability.kpis.sttSuccessRate}, azure=${speechReliability.kpis.azurePronunciationAvailability}, noSpeech=${speechReliability.kpis.noSpeechAttempts}`,
  );
  add(
    checks,
    'reports',
    'report aggregation returns internally consistent student counts',
    reportOverview.kpis.totalStudents === reportOverview.students.length &&
      reportOverview.kpis.studentsNeedingAttention === reportOverview.students.filter((student) => student.needsAttention).length &&
      reportOverview.kpis.audioAttemptCount === reportOverview.audioAttempts.length,
    `students=${reportOverview.kpis.totalStudents}/${reportOverview.students.length}, attention=${reportOverview.kpis.studentsNeedingAttention}, audio=${reportOverview.kpis.audioAttemptCount}`,
  );
  add(
    checks,
    'reports',
    'report aggregation keeps percentage metrics bounded',
    [
      reportOverview.kpis.diagnosticCompletionRate,
      reportOverview.kpis.averageScore,
      reportOverview.kpis.passRate,
      reportOverview.kpis.averagePronunciation,
      reportOverview.kpis.averageFluency,
    ].every((value) => value >= 0 && value <= 1),
    `kpis=${JSON.stringify(reportOverview.kpis)}`,
  );
  const firstReportStudent = reportOverview.students[0];
  if (firstReportStudent) {
    const tutorInsight = buildStudentTutorInsightFromSummary(firstReportStudent, reportOverview.topWeakWords);
    add(
      checks,
      'reports',
      'student AI tutor fallback returns actionable next steps',
      !!tutorInsight.headline && tutorInsight.actions.length > 0 && tutorInsight.actions.every((action) => action.href.startsWith('/')),
      `headline=${tutorInsight.headline}, actions=${tutorInsight.actions.map((action) => `${action.title}:${action.href}`).join('|')}`,
    );
  } else {
    add(checks, 'reports', 'student AI tutor fallback handles empty roster', true, 'no students in report database');
  }

  const improving = scoreMonologueImprovement([
    { speechRateWpm: 55, articulationRateWpm: 70, fluencyIndex: 0.35 },
    { speechRateWpm: 70, articulationRateWpm: 90, fluencyIndex: 0.50 },
    { speechRateWpm: 88, articulationRateWpm: 110, fluencyIndex: 0.66 },
  ]);
  add(checks, 'fluency', '4/3/2 improvement pattern receives positive credit', improving >= 0.45, `improvement=${improving}`);

  const noSpeechFeedback = generateFeedback(empty, '', ['water'], 1);
  add(
    checks,
    'feedback',
    'no-speech feedback does not praise the attempt',
    noSpeechFeedback.overall.level === 'no_speech' && noSpeechFeedback.strengths.length === 0,
    `level=${noSpeechFeedback.overall.level}, strengths=${noSpeechFeedback.strengths.length}`,
  );

  const partialFeedback = generateFeedback(partialSentence, 'I need water', ['I need a glass of water'], 2.5);
  add(
    checks,
    'feedback',
    'partial feedback identifies missing words',
    (partialFeedback.diff?.missingWords ?? []).includes('glass'),
    `missing=${(partialFeedback.diff?.missingWords ?? []).join(',')}`,
  );
  add(
    checks,
    'feedback',
    'feedback provides one next fix and a shadowable model answer',
    !!partialFeedback.nextFix?.title &&
      partialFeedback.nextAction === 'shadow_model' &&
      !!partialFeedback.modelAnswer?.includes('I need a glass of water'),
    `next=${partialFeedback.nextFix?.title}, action=${partialFeedback.nextAction}, model=${partialFeedback.modelAnswer}`,
  );

  const extraWordFeedback = generateFeedback(extraRepeatedWord, 'speak house house', ['house'], 2);
  add(
    checks,
    'feedback',
    'extra word feedback explicitly names the extra words',
    extraWordFeedback.overall.headline === 'Good target, extra words' && (extraWordFeedback.diff?.extraWords ?? []).includes('speak'),
    `headline=${extraWordFeedback.overall.headline}, extra=${(extraWordFeedback.diff?.extraWords ?? []).join(',')}`,
  );

  const homophoneFeedback = generateFeedback(homophoneWord, 'right', ['write'], 1);
  add(
    checks,
    'feedback',
    'homophone feedback asks for sentence context instead of saying perfect',
    homophoneFeedback.overall.headline === 'Needs context',
    `headline=${homophoneFeedback.overall.headline}, summary=${homophoneFeedback.overall.summary}`,
  );

  const waterFreeSpeakMetrics = computeFluencyMetrics({
    transcript: 'I drank water after lunch',
    audioDurationSeconds: 4,
    cefrBand: 'A1',
  });
  const waterFreeSpeak = scoreFreeSpeak({
    transcript: 'I drank water after lunch',
    targetText: 'water',
    requireTargetText: true,
    audioDurationSeconds: 4,
    cefrBand: 'A1',
    fluencyMetrics: waterFreeSpeakMetrics,
    aiGrade: {
      coherence: 0.95,
      reason: 'Coherent sentence.',
      fluencyComment: 'Steady pace.',
      aiAvailable: true,
      provider: 'ollama',
      model: 'test',
    },
  });
  add(
    checks,
    'free-speak',
    'target water used inside meaningful sentence passes',
    waterFreeSpeak.scores.composite >= 0.75 && waterFreeSpeak.scores.targetMatch === 1,
    `composite=${waterFreeSpeak.scores.composite}, target=${waterFreeSpeak.scores.targetMatch}`,
  );

  const missingWaterFreeSpeakMetrics = computeFluencyMetrics({
    transcript: 'I went to the mall yesterday and I found a cup',
    audioDurationSeconds: 5,
    cefrBand: 'A1',
  });
  const missingWaterFreeSpeak = scoreFreeSpeak({
    transcript: 'I went to the mall yesterday and I found a cup',
    targetText: 'water',
    requireTargetText: true,
    audioDurationSeconds: 5,
    cefrBand: 'A1',
    fluencyMetrics: missingWaterFreeSpeakMetrics,
    aiGrade: {
      coherence: 0.95,
      reason: 'Coherent sentence.',
      fluencyComment: 'Steady pace.',
      aiAvailable: true,
      provider: 'ollama',
      model: 'test',
    },
  });
  add(
    checks,
    'free-speak',
    'missing target water caps score at or below 45',
    missingWaterFreeSpeak.scores.composite <= 0.45 && missingWaterFreeSpeak.scores.targetMatch === 0,
    `composite=${missingWaterFreeSpeak.scores.composite}, target=${missingWaterFreeSpeak.scores.targetMatch}`,
  );

  const thankYouFreeSpeak = scoreFreeSpeak({
    transcript: 'I want to say thank you to my teacher',
    targetText: 'thank you',
    requireTargetText: true,
    audioDurationSeconds: 5,
    cefrBand: 'A1',
    aiGrade: { coherence: 0.95, reason: 'Coherent sentence.', aiAvailable: true },
  });
  add(
    checks,
    'free-speak',
    'phrase target thank you passes only when exact sequence appears',
    thankYouFreeSpeak.scores.composite >= 0.75 && thankYouFreeSpeak.scores.targetMatch === 1,
    `composite=${thankYouFreeSpeak.scores.composite}, target=${thankYouFreeSpeak.scores.targetMatch}`,
  );

  const howMuchFreeSpeak = scoreFreeSpeak({
    transcript: 'How much is this book?',
    targetText: 'how much',
    requireTargetText: true,
    audioDurationSeconds: 3,
    cefrBand: 'A1',
    aiGrade: { coherence: 0.95, reason: 'Coherent sentence.', aiAvailable: true },
  });
  add(
    checks,
    'free-speak',
    'phrase target how much passes case-insensitively with punctuation ignored',
    howMuchFreeSpeak.scores.composite >= 0.75 && howMuchFreeSpeak.scores.targetMatch === 1,
    `composite=${howMuchFreeSpeak.scores.composite}, target=${howMuchFreeSpeak.scores.targetMatch}`,
  );

  const missingHowMuchFreeSpeak = scoreFreeSpeak({
    transcript: 'I bought a book yesterday',
    targetText: 'how much',
    requireTargetText: true,
    audioDurationSeconds: 3,
    cefrBand: 'A1',
    aiGrade: { coherence: 0.95, reason: 'Coherent sentence.', aiAvailable: true },
  });
  add(
    checks,
    'free-speak',
    'missing phrase target how much caps score at or below 45',
    missingHowMuchFreeSpeak.scores.composite <= 0.45 && missingHowMuchFreeSpeak.scores.targetMatch === 0,
    `composite=${missingHowMuchFreeSpeak.scores.composite}, target=${missingHowMuchFreeSpeak.scores.targetMatch}`,
  );

  const writeHomophoneFreeSpeak = scoreFreeSpeak({
    transcript: 'I right my name in the notebook',
    targetText: 'write',
    requireTargetText: true,
    audioDurationSeconds: 4,
    cefrBand: 'A1',
    aiGrade: { coherence: 0.9, reason: 'Coherent sentence.', aiAvailable: true },
  });
  add(
    checks,
    'free-speak',
    'single-word target write accepts known homophone right',
    writeHomophoneFreeSpeak.scores.composite >= 0.7 && writeHomophoneFreeSpeak.scores.targetMatch === 1,
    `composite=${writeHomophoneFreeSpeak.scores.composite}, target=${writeHomophoneFreeSpeak.scores.targetMatch}`,
  );

  const singleWordFreeSpeak = scoreFreeSpeak({
    transcript: 'water',
    targetText: 'water',
    requireTargetText: true,
    audioDurationSeconds: 1,
    cefrBand: 'A1',
    aiGrade: { coherence: 0.9, aiAvailable: true },
  });
  add(
    checks,
    'free-speak',
    'one-word target-only free-speak response remains too short',
    singleWordFreeSpeak.scores.composite <= 0.35,
    `composite=${singleWordFreeSpeak.scores.composite}`,
  );

  const repeatedNonsenseFreeSpeak = scoreFreeSpeak({
    transcript: 'water water water water water water',
    targetText: 'water',
    requireTargetText: true,
    audioDurationSeconds: 4,
    cefrBand: 'A1',
    aiGrade: { coherence: 0.1, reason: 'Repeated nonsense.', aiAvailable: true },
  });
  add(
    checks,
    'free-speak',
    'repeated nonsense free-speak response cannot pass',
    repeatedNonsenseFreeSpeak.scores.composite <= 0.45 && repeatedNonsenseFreeSpeak.metadata.contentScore < 0.35,
    `composite=${repeatedNonsenseFreeSpeak.scores.composite}, content=${repeatedNonsenseFreeSpeak.metadata.contentScore}`,
  );

  const provisionalFreeSpeak = scoreFreeSpeak({
    transcript: 'I practice water words every morning before class',
    targetText: 'water',
    requireTargetText: true,
    audioDurationSeconds: 4,
    cefrBand: 'A1',
    aiGrade: { coherence: null, aiAvailable: false },
  });
  add(
    checks,
    'free-speak',
    'AI-unavailable free-speak is capped and marked provisional',
    provisionalFreeSpeak.metadata.provisional && provisionalFreeSpeak.scores.composite <= 0.72 && !!provisionalFreeSpeak.metadata.warning,
    `composite=${provisionalFreeSpeak.scores.composite}, warning=${provisionalFreeSpeak.metadata.warning}`,
  );

  const fluencyCommentA = scoreFreeSpeak({
    transcript: 'I practice water words every morning before class',
    targetText: 'water',
    requireTargetText: true,
    audioDurationSeconds: 4,
    cefrBand: 'A1',
    aiGrade: { coherence: 0.95, fluencyComment: 'Smooth.', aiAvailable: true },
  });
  const fluencyCommentB = scoreFreeSpeak({
    transcript: 'I practice water words every morning before class',
    targetText: 'water',
    requireTargetText: true,
    audioDurationSeconds: 4,
    cefrBand: 'A1',
    aiGrade: { coherence: 0.95, fluencyComment: 'Needs more pauses.', aiAvailable: true },
  });
  add(
    checks,
    'free-speak',
    'AI fluency comment does not change numeric fluency',
    fluencyCommentA.scores.fluency === fluencyCommentB.scores.fluency && fluencyCommentA.scores.composite === fluencyCommentB.scores.composite,
    `a=${fluencyCommentA.scores.composite}/${fluencyCommentA.scores.fluency}, b=${fluencyCommentB.scores.composite}/${fluencyCommentB.scores.fluency}`,
  );

  const freeSpeakRows = buildFreeSpeakRows(waterFreeSpeak.scores, waterFreeSpeak.metadata, 'water');
  add(
    checks,
    'ui',
    'Free Speak score help includes target, content, fluency, and sentence rows',
    ['Target Word', 'Content', 'Fluency', 'Sentence'].every((label) => freeSpeakRows.some((row) => row.label === label && row.help?.short && row.help?.detail)) &&
      FREE_SPEAK_COMPOSITE_HELP.composite?.short.includes('45%') === true,
    `rows=${freeSpeakRows.map((row) => row.label).join(',')}`,
  );

  const standardHelpRows = STANDARD_SCORE_HELP.rows ?? {};
  add(
    checks,
    'ui',
    'normal score help includes explanations for all standard score rows',
    ['targetMatch', 'pronunciation', 'fluency', 'completeness', 'consistency'].every((key) => {
      const help = standardHelpRows[key as keyof typeof standardHelpRows];
      return !!help?.short && !!help.detail;
    }) && !!STANDARD_SCORE_HELP.composite?.detail,
    `rows=${Object.keys(STANDARD_SCORE_HELP.rows ?? {}).join(',')}`,
  );

  const azureLowAccuracy = pronunciationWeakWordsFromAzureWords(
    [{ word: 'water', accuracy: 62, errorType: 'None', phonemes: [{ phoneme: 'ao', accuracy: 58 }] }],
    'repeat',
    '2026-06-15T00:00:00.000Z',
  );
  add(
    checks,
    'pronunciation',
    'Azure word accuracy below 75 becomes pronunciation weak-word evidence',
    azureLowAccuracy.length === 1 && azureLowAccuracy[0].word === 'water' && azureLowAccuracy[0].weakPhonemes[0]?.phoneme === 'ao',
    `evidence=${JSON.stringify(azureLowAccuracy)}`,
  );

  const azureErrorTypes = pronunciationWeakWordsFromAzureWords(
    [
      { word: 'write', accuracy: 92, errorType: 'Mispronunciation', phonemes: [] },
      { word: 'house', accuracy: 100, errorType: 'Omission', phonemes: [] },
    ],
    'read-aloud',
    '2026-06-15T00:00:00.000Z',
  );
  add(
    checks,
    'pronunciation',
    'Azure mispronunciation and omission become weak-word evidence',
    azureErrorTypes.length === 2 && azureErrorTypes.some((w) => w.errorType === 'Mispronunciation') && azureErrorTypes.some((w) => w.errorType === 'Omission'),
    `evidence=${JSON.stringify(azureErrorTypes)}`,
  );

  const transcriptOnlyPronunciation = pronunciationWeakWordsFromAzureWords(
    [{ word: 'school', accuracy: 90, errorType: 'None', phonemes: [{ phoneme: 's', accuracy: 90 }] }],
    'repeat',
    '2026-06-15T00:00:00.000Z',
  );
  add(
    checks,
    'pronunciation',
    'transcript-only or good Azure words do not create pronunciation weak words',
    transcriptOnlyPronunciation.length === 0,
    `evidence=${JSON.stringify(transcriptOnlyPronunciation)}`,
  );

  const textExact = compareTextToTranscript('I need a glass of water', 'I need a glass of water');
  add(checks, 'text-practice', 'exact read-aloud text scores 100 accuracy', textExact.accuracyScore === 100, `accuracy=${textExact.accuracyScore}`);

  const textBlank = compareTextToTranscript('I need a glass of water', '');
  add(checks, 'text-practice', 'blank read-aloud text scores zero', textBlank.accuracyScore === 0 && textBlank.completenessScore === 0, `accuracy=${textBlank.accuracyScore}, completeness=${textBlank.completenessScore}`);

  const coffee = getScenario('coffee');
  if (coffee) {
    const excellent = heuristicScenarioGrade(coffee, [
      { role: 'assistant', content: coffee.firstMessage },
      { role: 'user', content: 'Hi, I would like a large latte please.' },
      { role: 'assistant', content: 'Sure. Anything else?' },
      { role: 'user', content: 'How much is it? I will pay by card. Thank you.' },
    ]);
    add(checks, 'scenario', 'coffee scenario fallback rewards completed goal', excellent.score >= 75 && excellent.criteriaMet.filter(Boolean).length >= 3, `score=${excellent.score}, met=${excellent.criteriaMet}`);

    const emptyScenario = heuristicScenarioGrade(coffee, [
      { role: 'assistant', content: coffee.firstMessage },
      { role: 'user', content: '' },
      { role: 'assistant', content: 'Can you repeat that?' },
      { role: 'user', content: '' },
    ]);
    add(checks, 'scenario', 'empty scenario fallback scores zero', emptyScenario.score === 0 && emptyScenario.criteriaMet.every((v) => !v), `score=${emptyScenario.score}, met=${emptyScenario.criteriaMet}`);

    const repeatedScenario = heuristicScenarioGrade(coffee, [
      { role: 'assistant', content: coffee.firstMessage },
      { role: 'user', content: 'yes yes yes yes yes yes yes yes' },
      { role: 'assistant', content: 'What would you like?' },
      { role: 'user', content: 'yes yes yes yes' },
    ]);
    add(checks, 'scenario', 'repeated scenario response cannot pass', repeatedScenario.score <= 25, `score=${repeatedScenario.score}`);

    const guarded = applyLocalScenarioGuard(
      { criteriaMet: [true, true, true, true], score: 100, feedback: 'Great work.' },
      coffee,
      [{ role: 'user', content: 'yes yes yes yes yes yes yes yes' }],
    );
    add(checks, 'scenario', 'local guard caps over-generous AI score', guarded.score <= 25, `score=${guarded.score}, met=${guarded.criteriaMet}`);

    const practiceAmScenario = {
      ...coffee,
      id: 'klp-test-am',
      title: 'Practice am',
      description: 'Use am in a short lesson conversation.',
      studentGoal: 'Use am in one clear English sentence.',
      targetVocabulary: ['am'],
      systemPrompt: 'You are a helpful classmate. Practice the word am.',
      successCriteria: [
        'Responded with meaningful English',
        'Used the target lesson language where appropriate',
        'Kept the conversation going with a clear answer',
        'Spoke politely and naturally',
      ],
    };
    const adultRedirect = guardScenarioTurn(practiceAmScenario, 'I would like to talk about sex.');
    add(
      checks,
      'scenario',
      'AI conversation blocks adult topic changes before provider call',
      adultRedirect.blocked && adultRedirect.reason === 'unsafe' && adultRedirect.reply.includes('Practice am') && adultRedirect.reply.includes('I am a student'),
      `blocked=${adultRedirect.blocked}, reason=${adultRedirect.reason}, reply=${adultRedirect.reply}`,
    );
    const offTopicRedirect = guardScenarioTurn(practiceAmScenario, 'I would like to talk about football instead.');
    add(
      checks,
      'scenario',
      'AI conversation redirects off-topic scenario changes to target language',
      offTopicRedirect.blocked && offTopicRedirect.reason === 'topic_change' && offTopicRedirect.reply.includes('Practice am'),
      `blocked=${offTopicRedirect.blocked}, reason=${offTopicRedirect.reason}`,
    );
    const validLessonTurn = guardScenarioTurn(practiceAmScenario, 'I am a student.');
    add(
      checks,
      'scenario',
      'AI conversation allows valid target-language turns',
      !validLessonTurn.blocked,
      `blocked=${validLessonTurn.blocked}, reason=${validLessonTurn.reason}`,
    );
    const shortAmProgress = heuristicScenarioGrade(practiceAmScenario, [
      { role: 'assistant', content: 'Can you answer with am ready?' },
      { role: 'user', content: 'I am ready.' },
    ]);
    add(
      checks,
      'scenario',
      'KLP target-language scenario gives live progress for one correct short answer',
      shortAmProgress.criteriaMet[0] &&
        shortAmProgress.criteriaMet[1] &&
        shortAmProgress.score > 0 &&
        shortAmProgress.score <= 60 &&
        Array.isArray(shortAmProgress.criteriaDetails),
      `score=${shortAmProgress.score}, met=${shortAmProgress.criteriaMet}`,
    );
    const completedAmProgress = heuristicScenarioGrade(practiceAmScenario, [
      { role: 'assistant', content: 'Can you answer with am ready?' },
      { role: 'user', content: 'I am ready.' },
      { role: 'assistant', content: 'Good. Now use am excited.' },
      { role: 'user', content: 'I am excited.' },
    ]);
    add(
      checks,
      'scenario',
      'KLP target-language scenario passes after repeated correct target use',
      completedAmProgress.score >= 75 &&
        completedAmProgress.criteriaMet.filter(Boolean).length >= 3,
      `score=${completedAmProgress.score}, met=${completedAmProgress.criteriaMet}`,
    );
    const guardedAmProgress = applyLocalScenarioGuard(
      { criteriaMet: [false, false, false, false], score: 0, feedback: 'Not enough.' },
      practiceAmScenario,
      [
        { role: 'assistant', content: 'Can you answer with am ready?' },
        { role: 'user', content: 'I am ready.' },
        { role: 'assistant', content: 'Good. Now use am excited.' },
        { role: 'user', content: 'I am excited.' },
      ],
    );
    add(
      checks,
      'scenario',
      'local KLP criteria prevent false zero from strict AI scenario grader',
      guardedAmProgress.score >= 75 &&
        guardedAmProgress.criteriaMet.filter(Boolean).length >= 3,
      `score=${guardedAmProgress.score}, met=${guardedAmProgress.criteriaMet}`,
    );
    const scenarioPrompt = buildScenarioSystemPrompt(practiceAmScenario);
    add(
      checks,
      'scenario',
      'scenario system prompt includes lesson-focus guardrails',
      scenarioPrompt.includes('Target language/vocabulary') && scenarioPrompt.includes('Never say you are ready'),
      `length=${scenarioPrompt.length}`,
    );
  }

  add(checks, 'mastery', 'one high attempt does not mark mastered', masteryStatusFor(0.96, 0.96, 1) !== 'Mastered', `status=${masteryStatusFor(0.96, 0.96, 1)}`);
  add(checks, 'mastery', 'two strong attempts mark mastered', masteryStatusFor(0.96, 0.90, 2) === 'Mastered', `status=${masteryStatusFor(0.96, 0.90, 2)}`);
  add(checks, 'mastery', 'bad latest attempt demotes from mastered signal', masteryStatusFor(0.96, 0.30, 3) !== 'Mastered', `status=${masteryStatusFor(0.96, 0.30, 3)}`);

  const failures = checks.filter((c) => !c.pass);
  const byCategory = checks.reduce<Record<string, { total: number; failed: number }>>((acc, check) => {
    acc[check.category] ??= { total: 0, failed: 0 };
    acc[check.category].total += 1;
    if (!check.pass) acc[check.category].failed += 1;
    return acc;
  }, {});

  return Response.json({
    passed: failures.length === 0,
    total: checks.length,
    failed: failures.length,
    byCategory,
    failures,
    checks: checks.map((check) => ({
      ...check,
      detail: check.detail.replace(/(\d+\.\d{3})\d+/g, '$1'),
    })),
    summary: {
      correctWord: pct(correctWord.composite),
      wrongWord: pct(wrongWord.composite),
      partialSentence: pct(partialSentence.composite),
      extraRepeatedWord: pct(extraRepeatedWord.composite),
      homophoneTargetMatch: pct(homophoneWord.targetMatch),
      yoyoAdjusted: pct(yoyoAdjusted),
      improvingMonologue: pct(improving),
    },
  });
}
