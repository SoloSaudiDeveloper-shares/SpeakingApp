/**
 * Curriculum templates — ready-made lesson bundles a teacher can provision in
 * one click. Each template seeds a vocabulary book (with example sentences for
 * the sentence/shadowing stages) and a suggested stage configuration.
 *
 * These are intentionally compact starter sets; teachers extend them after.
 */

export type CefrBand = "A1" | "A2" | "B1" | "B2";

export interface TemplateWord {
  word: string;
  arabicMeaning?: string;
  partOfSpeech?: string;
  exampleSentence?: string;
}

export interface CurriculumTemplate {
  id: string;
  title: string;
  description: string;
  cefrLevel: CefrBand;
  focus: string;
  stageSequence: string[];
  unlockMode: "sequential" | "all" | "free";
  suggestedScenarios: string[]; // scenario ids from ai/scenarios.ts
  words: TemplateWord[];
}

export const CURRICULUM_TEMPLATES: CurriculumTemplate[] = [
  {
    id: "survival-a1",
    title: "Beginner Survival English",
    description: "The essential words and phrases for everyday situations — greetings, basic needs, and politeness.",
    cefrLevel: "A1",
    focus: "Core everyday vocabulary + clear pronunciation",
    stageSequence: ["listen", "repeat", "read-aloud", "sentence", "review"],
    unlockMode: "sequential",
    suggestedScenarios: ["coffee", "directions"],
    words: [
      { word: "hello", arabicMeaning: "مرحبا", partOfSpeech: "interjection", exampleSentence: "Hello, nice to meet you." },
      { word: "please", arabicMeaning: "من فضلك", partOfSpeech: "adverb", exampleSentence: "Can I have water, please?" },
      { word: "thank you", arabicMeaning: "شكرا", partOfSpeech: "interjection", exampleSentence: "Thank you for your help." },
      { word: "sorry", arabicMeaning: "آسف", partOfSpeech: "adjective", exampleSentence: "I'm sorry, I'm late." },
      { word: "water", arabicMeaning: "ماء", partOfSpeech: "noun", exampleSentence: "I would like some water." },
      { word: "food", arabicMeaning: "طعام", partOfSpeech: "noun", exampleSentence: "The food is delicious." },
      { word: "help", arabicMeaning: "مساعدة", partOfSpeech: "noun", exampleSentence: "Can you help me, please?" },
      { word: "where", arabicMeaning: "أين", partOfSpeech: "adverb", exampleSentence: "Where is the bathroom?" },
      { word: "how much", arabicMeaning: "كم", partOfSpeech: "phrase", exampleSentence: "How much is this?" },
      { word: "yes", arabicMeaning: "نعم", partOfSpeech: "adverb", exampleSentence: "Yes, I understand." },
      { word: "no", arabicMeaning: "لا", partOfSpeech: "adverb", exampleSentence: "No, thank you." },
      { word: "name", arabicMeaning: "اسم", partOfSpeech: "noun", exampleSentence: "My name is Sara." },
    ],
  },
  {
    id: "conversation-a2",
    title: "Everyday Conversations",
    description: "Vocabulary and phrases for daily small talk, shopping, and getting around.",
    cefrLevel: "A2",
    focus: "Connected speech + real-world conversations",
    stageSequence: ["listen", "repeat", "read-aloud", "sentence", "free-speak", "review"],
    unlockMode: "sequential",
    suggestedScenarios: ["restaurant", "shopping", "airport", "smalltalk"],
    words: [
      { word: "weekend", arabicMeaning: "عطلة نهاية الأسبوع", partOfSpeech: "noun", exampleSentence: "What did you do on the weekend?" },
      { word: "weather", arabicMeaning: "طقس", partOfSpeech: "noun", exampleSentence: "The weather is nice today." },
      { word: "expensive", arabicMeaning: "غالي", partOfSpeech: "adjective", exampleSentence: "This jacket is too expensive." },
      { word: "cheap", arabicMeaning: "رخيص", partOfSpeech: "adjective", exampleSentence: "I want something cheaper." },
      { word: "ticket", arabicMeaning: "تذكرة", partOfSpeech: "noun", exampleSentence: "I need a ticket to London." },
      { word: "menu", arabicMeaning: "قائمة الطعام", partOfSpeech: "noun", exampleSentence: "Can I see the menu, please?" },
      { word: "order", arabicMeaning: "يطلب", partOfSpeech: "verb", exampleSentence: "I'd like to order the chicken." },
      { word: "size", arabicMeaning: "مقاس", partOfSpeech: "noun", exampleSentence: "Do you have this in a larger size?" },
      { word: "bill", arabicMeaning: "فاتورة", partOfSpeech: "noun", exampleSentence: "Could we have the bill, please?" },
      { word: "busy", arabicMeaning: "مشغول", partOfSpeech: "adjective", exampleSentence: "I was really busy this week." },
      { word: "tired", arabicMeaning: "متعب", partOfSpeech: "adjective", exampleSentence: "I'm a bit tired today." },
      { word: "favourite", arabicMeaning: "مفضل", partOfSpeech: "adjective", exampleSentence: "What's your favourite food?" },
    ],
  },
  {
    id: "business-b1",
    title: "Business Conversations",
    description: "Professional vocabulary for meetings, interviews, and workplace communication.",
    cefrLevel: "B1",
    focus: "Fluency under pressure + professional register",
    stageSequence: ["read-aloud", "sentence", "free-speak", "review"],
    unlockMode: "all",
    suggestedScenarios: ["interview", "smalltalk", "doctor"],
    words: [
      { word: "meeting", arabicMeaning: "اجتماع", partOfSpeech: "noun", exampleSentence: "We have a meeting at ten o'clock." },
      { word: "deadline", arabicMeaning: "موعد نهائي", partOfSpeech: "noun", exampleSentence: "The deadline is next Friday." },
      { word: "experience", arabicMeaning: "خبرة", partOfSpeech: "noun", exampleSentence: "I have five years of experience." },
      { word: "responsible", arabicMeaning: "مسؤول", partOfSpeech: "adjective", exampleSentence: "I'm responsible for the team." },
      { word: "schedule", arabicMeaning: "جدول", partOfSpeech: "noun", exampleSentence: "Let me check my schedule." },
      { word: "project", arabicMeaning: "مشروع", partOfSpeech: "noun", exampleSentence: "I'm leading a new project." },
      { word: "challenge", arabicMeaning: "تحدي", partOfSpeech: "noun", exampleSentence: "It was a difficult challenge." },
      { word: "improve", arabicMeaning: "يحسن", partOfSpeech: "verb", exampleSentence: "I want to improve my skills." },
      { word: "agree", arabicMeaning: "يوافق", partOfSpeech: "verb", exampleSentence: "I agree with your idea." },
      { word: "suggest", arabicMeaning: "يقترح", partOfSpeech: "verb", exampleSentence: "I suggest we start now." },
      { word: "available", arabicMeaning: "متاح", partOfSpeech: "adjective", exampleSentence: "Are you available tomorrow?" },
      { word: "opportunity", arabicMeaning: "فرصة", partOfSpeech: "noun", exampleSentence: "This is a great opportunity." },
    ],
  },
];

export function getTemplate(id: string): CurriculumTemplate | undefined {
  return CURRICULUM_TEMPLATES.find((t) => t.id === id);
}
