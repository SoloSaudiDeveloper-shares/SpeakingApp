const HOMOPHONE_GROUPS = [
  ["write", "right"],
  ["read", "reed"],
  ["red", "read"],
  ["see", "sea"],
  ["to", "too", "two"],
  ["there", "their", "they're"],
  ["hear", "here"],
  ["new", "knew"],
  ["no", "know"],
  ["one", "won"],
  ["for", "four"],
  ["be", "bee"],
  ["by", "buy", "bye"],
  ["hour", "our"],
  ["which", "witch"],
  ["your", "you're"],
  ["its", "it's"],
  ["son", "sun"],
  ["week", "weak"],
  ["meet", "meat"],
  ["flour", "flower"],
  ["peace", "piece"],
  ["pair", "pear", "pare"],
  ["plain", "plane"],
  ["weather", "whether"],
  ["wear", "where"],
]

const canonical = new Map<string, string>()

for (const group of HOMOPHONE_GROUPS) {
  const key = group[0]
  for (const word of group) canonical.set(word, key)
}

export function normalizeWordToken(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, "")
    .trim()
}

export function areHomophones(a: string, b: string): boolean {
  const left = normalizeWordToken(a)
  const right = normalizeWordToken(b)
  if (!left || !right || left === right) return false
  const leftCanonical = canonical.get(left)
  const rightCanonical = canonical.get(right)
  return !!leftCanonical && !!rightCanonical && leftCanonical === rightCanonical
}

export function areEquivalentWords(a: string, b: string): boolean {
  const left = normalizeWordToken(a)
  const right = normalizeWordToken(b)
  return !!left && !!right && (left === right || areHomophones(left, right))
}
