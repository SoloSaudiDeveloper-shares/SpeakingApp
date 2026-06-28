/**
 * Topics for the 4/3/2 timed-monologue fluency drill (Nation 1989).
 * Banded by CEFR so lower levels get concrete, everyday topics and higher
 * levels get abstract/opinion topics. Same `{ id, title, prompt }` shape as the
 * conversation page's TOPIC_STARTERS.
 */

export type CefrBand = "A1" | "A2" | "B1" | "B2";

export interface MonologueTopic {
  id: string;
  title: string;
  prompt: string;
  bands: CefrBand[];
}

export const MONOLOGUE_TOPICS: MonologueTopic[] = [
  // A1 — concrete, daily
  { id: "morning", title: "My morning routine", prompt: "Describe what you do every morning, from waking up to leaving the house.", bands: ["A1", "A2"] },
  { id: "family", title: "My family", prompt: "Tell me about your family — who they are and what they like to do.", bands: ["A1", "A2"] },
  { id: "room", title: "My favorite room", prompt: "Describe your favorite room at home and what is in it.", bands: ["A1", "A2"] },
  { id: "food-day", title: "What I eat in a day", prompt: "Talk about the food you eat for breakfast, lunch, and dinner.", bands: ["A1", "A2"] },

  // A2 / B1 — narrative, preferences
  { id: "weekend", title: "My last weekend", prompt: "Tell the story of what you did last weekend, from start to finish.", bands: ["A2", "B1"] },
  { id: "hobby", title: "A hobby I love", prompt: "Describe a hobby you enjoy, why you like it, and how you got started.", bands: ["A2", "B1"] },
  { id: "place", title: "A place I want to visit", prompt: "Describe a place you would love to visit and explain why.", bands: ["A2", "B1"] },
  { id: "friend", title: "My best friend", prompt: "Describe your best friend and a memory you share together.", bands: ["A2", "B1"] },

  // B1 / B2 — opinion, abstract
  { id: "technology", title: "Technology in my life", prompt: "Explain how technology has changed the way you live and work.", bands: ["B1", "B2"] },
  { id: "goal", title: "A goal for my future", prompt: "Describe an important goal you have and your plan to achieve it.", bands: ["B1", "B2"] },
  { id: "change", title: "Something I would change", prompt: "If you could change one thing about your city or country, what would it be and why?", bands: ["B1", "B2"] },
  { id: "learning", title: "Learning English", prompt: "Talk about why you are learning English and how it will help you.", bands: ["B1", "B2"] },
];

export function topicsForBand(band: CefrBand): MonologueTopic[] {
  const list = MONOLOGUE_TOPICS.filter((t) => t.bands.includes(band));
  return list.length > 0 ? list : MONOLOGUE_TOPICS;
}
