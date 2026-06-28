import type { Scenario } from './scenarios';

export interface ScenarioGrade {
  criteriaMet: boolean[];
  score: number;
  feedback: string;
  criteriaDetails?: ScenarioCriterionDetail[];
}

export interface ScenarioCriterionDetail {
  criterion: string;
  met: boolean;
  reason: string;
  evidence?: string;
}

type ScenarioMessage = { role: string; content: string };

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'get', 'go', 'have',
  'how', 'i', 'is', 'it', 'me', 'my', 'of', 'or', 'please', 'the', 'there',
  'this', 'to', 'today', 'want', 'what', 'with', 'you',
]);

function userText(messages: ScenarioMessage[]): string {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ')
    .trim();
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) ?? []).map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean);
}

function normalizedText(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9']+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function hasAny(text: string, phrases: string[]): boolean {
  const normalized = normalizedText(text);
  return phrases.some((phrase) => normalized.includes(` ${phrase.toLowerCase()} `));
}

function hasQuestionAbout(text: string, topics: string[]): boolean {
  return hasAny(text, ['how', 'what', 'where', 'when', 'which', 'can', 'could', 'do', 'does', 'is', 'are'])
    && hasAny(text, topics);
}

function contentWords(words: string[]): string[] {
  return words.filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function sentenceCount(text: string): number {
  return text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
}

function userTurns(messages: ScenarioMessage[]): string[] {
  return messages
    .filter((m) => m.role === 'user' && m.content.trim())
    .map((m) => m.content.trim());
}

function scenarioTargets(scenario: Scenario): string[] {
  const targets = new Set<string>();
  for (const item of scenario.targetVocabulary ?? []) {
    const cleaned = item.trim();
    if (cleaned) targets.add(cleaned);
  }
  const practiceMatch = scenario.title.match(/^practice\s+(.+)$/i);
  if (practiceMatch?.[1]?.trim()) targets.add(practiceMatch[1].trim());
  return Array.from(targets);
}

function phraseUsed(text: string, phrase: string): boolean {
  const normalizedPhrase = phrase.toLowerCase().replace(/[^a-z0-9']+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalizedPhrase) return false;
  return normalizedText(text).includes(` ${normalizedPhrase} `);
}

function targetEvidence(scenario: Scenario, text: string): { used: boolean; target: string | null } {
  for (const target of scenarioTargets(scenario)) {
    if (phraseUsed(text, target)) return { used: true, target };
  }
  return { used: false, target: scenarioTargets(scenario)[0] ?? null };
}

export function localScenarioQuality(messages: ScenarioMessage[]) {
  const text = userText(messages);
  const words = tokens(text);
  const meaningful = contentWords(words);
  const unique = new Set(meaningful);
  const alphaChars = text.match(/[a-z]/gi)?.length ?? 0;
  const totalChars = text.replace(/\s+/g, '').length;
  const topCount = meaningful.reduce((max, word) => {
    const count = meaningful.filter((w) => w === word).length;
    return Math.max(max, count);
  }, 0);
  const topShare = meaningful.length ? topCount / meaningful.length : 0;
  const repeated = meaningful.length >= 4 && (unique.size <= 2 || topShare >= 0.65);
  const tooShort = meaningful.length < 3;
  const mostlyNonEnglish = totalChars > 0 && alphaChars / totalChars < 0.45;

  let scoreCap = 100;
  if (words.length === 0 || meaningful.length === 0) scoreCap = 0;
  else if (mostlyNonEnglish) scoreCap = 25;
  else if (repeated) scoreCap = 25;
  else if (tooShort) scoreCap = 35;

  return {
    text,
    wordCount: words.length,
    meaningfulWordCount: meaningful.length,
    uniqueMeaningfulWords: unique.size,
    repeated,
    tooShort,
    mostlyNonEnglish,
    scoreCap,
  };
}

function genericCriterionMet(criterion: string, words: Set<string>): boolean {
  const criterionWords = contentWords(tokens(criterion));
  if (criterionWords.length === 0) return false;
  const hits = criterionWords.filter((word) => words.has(word)).length;
  return hits >= Math.min(2, criterionWords.length);
}

function evaluateDynamicCriterion(
  criterion: string,
  scenario: Scenario,
  messages: ScenarioMessage[],
  quality: ReturnType<typeof localScenarioQuality>,
): ScenarioCriterionDetail | null {
  const lower = criterion.toLowerCase();
  const text = quality.text;
  const turns = userTurns(messages);
  const target = targetEvidence(scenario, text);
  const meaningful =
    quality.wordCount >= 2 &&
    quality.meaningfulWordCount >= 2 &&
    !quality.repeated &&
    !quality.mostlyNonEnglish;
  const hasQuestion = /\?/.test(text) || hasAny(text, ['how', 'what', 'where', 'when', 'which', 'can', 'could', 'do you', 'are you']);
  const polite = hasAny(text, ['hi', 'hello', 'thanks', 'thank you', 'thank', 'please', 'good morning', 'good evening', 'excuse me']);
  const hasSeveralClearTurns = turns.length >= 2 && turns.some((turn) => contentWords(tokens(turn)).length >= 2);
  const naturalEnough = meaningful && (sentenceCount(text) >= 2 || hasSeveralClearTurns || target.used);

  if (/target|lesson language|vocab|vocabulary|where appropriate|use(d)?\s+.+language/.test(lower)) {
    return {
      criterion,
      met: target.used,
      reason: target.used
        ? `Used the target language "${target.target}".`
        : target.target
          ? `Use "${target.target}" in one of your answers.`
          : 'Use the target lesson language in your answer.',
      evidence: target.used ? target.target ?? undefined : undefined,
    };
  }

  if (/conversation|kept|going|follow[- ]?up|clear answer/.test(lower)) {
    const met = meaningful && (turns.length >= 2 || hasQuestion || quality.meaningfulWordCount >= 5);
    return {
      criterion,
      met,
      reason: met
        ? 'The student kept the exchange moving with a clear answer.'
        : 'Add another clear answer or a simple follow-up to continue the exchange.',
    };
  }

  if (/meaningful english|clear english|responded/.test(lower)) {
    return {
      criterion,
      met: meaningful,
      reason: meaningful
        ? 'The student gave a clear English response.'
        : 'The response needs clearer English meaning.',
    };
  }

  if (/polite|politely|natural|naturally/.test(lower)) {
    const met = meaningful && !quality.repeated && !quality.mostlyNonEnglish && (polite || naturalEnough);
    return {
      criterion,
      met,
      reason: met
        ? polite
          ? 'The response used polite, natural English.'
          : 'The response was natural enough for this speaking task.'
        : 'Use a complete, natural answer; polite words like please or thank you help when they fit.',
    };
  }

  if (/ask(ed)?|question/.test(lower)) {
    return {
      criterion,
      met: hasQuestion,
      reason: hasQuestion ? 'The student asked a question.' : 'Ask one relevant question to meet this goal.',
    };
  }

  return null;
}

function localCriterionMet(scenarioId: string, index: number, text: string, wordSet: Set<string>): boolean {
  const polite = () => hasAny(text, ['hi', 'hello', 'thanks', 'thank', 'please', 'good morning', 'good evening']);
  const priceOrPay = () => hasAny(text, ['price', 'cost', 'pay', 'paid', 'cash', 'card', 'how much']);
  const size = () => hasAny(text, ['small', 'medium', 'large', 'regular']);
  const drink = () => hasAny(text, ['coffee', 'tea', 'latte', 'cappuccino', 'espresso', 'water', 'juice']);
  const food = () => hasAny(text, ['meal', 'chicken', 'rice', 'fish', 'salad', 'burger', 'pasta', 'soup', 'sandwich', 'dish']);
  const thanks = () => hasAny(text, ['thanks', 'thank you', 'thank']);

  switch (scenarioId) {
    case 'coffee':
      return [polite, drink, size, priceOrPay][index]?.() ?? false;
    case 'restaurant':
      return [drink, food, () => hasQuestionAbout(text, ['food', 'menu', 'dish', 'spicy', 'vegetarian']), () => hasAny(text, ['bill', 'check', 'pay'])][index]?.() ?? false;
    case 'shopping':
      return [
        () => hasAny(text, ['shirt', 'dress', 'shoes', 'jacket', 'pants', 'trousers', 'clothes']),
        () => hasAny(text, ['size', 'color', 'colour', 'small', 'medium', 'large', 'red', 'blue', 'black', 'white']),
        priceOrPay,
        () => hasAny(text, ['buy', 'take', 'not buy', 'no thanks', 'maybe later']),
      ][index]?.() ?? false;
    case 'directions':
      return [
        () => hasAny(text, ['station', 'hotel', 'airport', 'museum', 'school', 'hospital', 'restaurant', 'bank', 'park']),
        () => hasQuestionAbout(text, ['get', 'go', 'way', 'directions', 'where']),
        () => hasQuestionAbout(text, ['far', 'time', 'minutes', 'distance', 'walk']),
        thanks,
      ][index]?.() ?? false;
    case 'doctor':
      return [
        () => hasAny(text, ['hurt', 'pain', 'fever', 'cough', 'headache', 'sick', 'stomach', 'throat']),
        () => wordSet.size >= 8,
        () => hasQuestionAbout(text, ['medicine', 'treatment', 'advice', 'take', 'do']),
        () => hasAny(text, ['understand', 'i will', 'okay doctor', 'ok doctor']),
      ][index]?.() ?? false;
    case 'interview':
      return [
        () => hasAny(text, ['my name', 'i am', "i'm"]),
        () => hasAny(text, ['skill', 'strength', 'good at', 'can', 'experience']),
        () => hasAny(text, ['example', 'worked', 'job', 'project', 'experience']),
        () => hasQuestionAbout(text, ['job', 'work', 'team', 'salary', 'hours']),
      ][index]?.() ?? false;
    case 'airport':
      return [
        () => hasAny(text, ['riyadh', 'jeddah', 'dubai', 'london', 'paris', 'airport', 'flight']),
        () => hasAny(text, ['bag', 'luggage', 'suitcase']),
        () => hasQuestionAbout(text, ['gate', 'boarding', 'time']),
        thanks,
      ][index]?.() ?? false;
    case 'smalltalk':
      return [
        () => wordSet.size >= 4,
        () => hasQuestionAbout(text, ['you', 'weekend', 'plans']),
        () => wordSet.size >= 8,
        () => messagesTurnCount(text) >= 2 || wordSet.size >= 12,
      ][index]?.() ?? false;
    default:
      return false;
  }
}

function messagesTurnCount(text: string): number {
  return text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
}

export function heuristicScenarioGrade(scenario: Scenario, messages: ScenarioMessage[]): ScenarioGrade {
  const quality = localScenarioQuality(messages);
  const wordSet = new Set(contentWords(tokens(quality.text)));

  if (quality.scoreCap === 0) {
    return {
      criteriaMet: scenario.successCriteria.map(() => false),
      score: 0,
      feedback: 'No clear English response was detected. Try again and answer the role-play partner.',
      criteriaDetails: scenario.successCriteria.map((criterion) => ({
        criterion,
        met: false,
        reason: 'No clear English response was detected.',
      })),
    };
  }

  const criteriaDetails = scenario.successCriteria.map((criterion, index) => {
    const specificMet = localCriterionMet(scenario.id, index, quality.text, wordSet);
    const dynamic = evaluateDynamicCriterion(criterion, scenario, messages, quality);
    if (dynamic) {
      return specificMet
        ? { ...dynamic, met: true, reason: dynamic.met ? dynamic.reason : 'The response met this scenario-specific goal.' }
        : dynamic;
    }
    const genericMet = genericCriterionMet(criterion, wordSet);
    return {
      criterion,
      met: specificMet || genericMet,
      reason: specificMet || genericMet
        ? 'The response includes evidence for this goal.'
        : 'This goal was not clearly shown yet.',
    };
  });
  const criteriaMet = criteriaDetails.map((detail) => detail.met);
  const met = criteriaMet.filter(Boolean).length;
  const rawScore = Math.round((met / Math.max(1, scenario.successCriteria.length)) * 100);
  const score = Math.min(rawScore, quality.scoreCap);

  return {
    criteriaMet,
    score,
    feedback: score >= 70
      ? 'Good scenario practice. Keep adding details and asking natural follow-up questions.'
      : 'Try again with more specific English that matches the situation and completes the goal.',
    criteriaDetails,
  };
}

export function applyLocalScenarioGuard(
  grade: ScenarioGrade,
  scenario: Scenario,
  messages: ScenarioMessage[],
): ScenarioGrade {
  const quality = localScenarioQuality(messages);
  const local = heuristicScenarioGrade(scenario, messages);
  if (quality.scoreCap === 0) {
    return {
      criteriaMet: scenario.successCriteria.map(() => false),
      score: 0,
      feedback: 'No clear English response was detected. Try again and answer the role-play partner.',
    };
  }

  const localCriteriaCeiling = local.score >= 70 ? 100 : Math.max(quality.scoreCap < 100 ? quality.scoreCap : 40, local.score + 25);
  let score = Math.min(
    Math.max(0, Math.min(100, Number(grade.score) || 0)),
    quality.scoreCap,
    localCriteriaCeiling,
  );
  if (local.score >= 75 && quality.scoreCap >= 90) {
    score = Math.max(score, Math.min(85, local.score - 15));
  }
  const aiCriteriaMet = Array.isArray(grade.criteriaMet)
    ? grade.criteriaMet.slice(0, scenario.successCriteria.length).map(Boolean)
    : [];
  while (aiCriteriaMet.length < scenario.successCriteria.length) aiCriteriaMet.push(false);
  const criteriaMet = scenario.successCriteria.map((_, index) => Boolean(aiCriteriaMet[index] || local.criteriaMet[index]));
  const met = criteriaMet.filter(Boolean).length;
  const mergedCriteriaScore = Math.round((met / Math.max(1, scenario.successCriteria.length)) * 100);
  score = Math.min(Math.max(score, local.score, mergedCriteriaScore), quality.scoreCap, localCriteriaCeiling);
  const criteriaDetails = scenario.successCriteria.map((criterion, index) => {
    const localDetail = local.criteriaDetails?.[index];
    if (criteriaMet[index]) {
      return {
        criterion,
        met: true,
        reason: localDetail?.met
          ? localDetail.reason
          : 'The AI grader found evidence for this goal.',
        evidence: localDetail?.evidence,
      };
    }
    return localDetail ?? {
      criterion,
      met: false,
      reason: 'This goal was not clearly shown yet.',
    };
  });

  return {
    criteriaMet,
    score,
    feedback: typeof grade.feedback === 'string' && grade.feedback.trim()
      ? grade.feedback
      : heuristicScenarioGrade(scenario, messages).feedback,
    criteriaDetails,
  };
}
