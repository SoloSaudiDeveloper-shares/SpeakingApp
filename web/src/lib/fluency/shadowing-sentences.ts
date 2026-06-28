/**
 * Reference sentences for the shadowing fluency drill. Banded by CEFR.
 * The student hears each sentence (TTS) and repeats it, trying to match the
 * model's rhythm and pace. Sentences progress from short/simple to longer,
 * connected speech with natural collocations and linking.
 */

export type CefrBand = "A1" | "A2" | "B1" | "B2";

export interface ShadowingSet {
  band: CefrBand;
  title: string;
  sentences: string[];
}

export const SHADOWING_SETS: ShadowingSet[] = [
  {
    band: "A1",
    title: "Everyday basics",
    sentences: [
      "Good morning, how are you today?",
      "I would like a cup of coffee, please.",
      "My name is Sara and I am a student.",
      "Can you help me, please?",
      "Thank you very much, have a nice day.",
    ],
  },
  {
    band: "A2",
    title: "Daily situations",
    sentences: [
      "I usually wake up at seven o'clock every morning.",
      "On the weekend, I like to meet my friends.",
      "Could you tell me where the train station is?",
      "I'm looking for a present for my brother.",
      "The weather is really nice today, isn't it?",
    ],
  },
  {
    band: "B1",
    title: "Connected speech",
    sentences: [
      "I've been thinking about taking an online course next month.",
      "To be honest, I'd rather stay home than go out tonight.",
      "She told me she was planning to move to a new city.",
      "If I had more free time, I would definitely travel more.",
      "It took me a while to get used to my new job.",
    ],
  },
  {
    band: "B2",
    title: "Natural fluency",
    sentences: [
      "Frankly, I think the benefits far outweigh the drawbacks in this case.",
      "What strikes me most is how quickly the whole situation changed.",
      "I can't help but wonder whether we made the right decision.",
      "Having considered all the options, we decided to go ahead with the plan.",
      "It's not so much what you say as how you say it that matters.",
    ],
  },
];

export function shadowingSetForBand(band: CefrBand): ShadowingSet {
  return SHADOWING_SETS.find((s) => s.band === band) ?? SHADOWING_SETS[0];
}
