import {
  RegExpMatcher,
  TextCensor,
  asteriskCensorStrategy,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity'

// Built once at module load. Offline, no network — the English dataset ships
// with the package and the recommended transformers catch common obfuscation
// (leetspeak, unicode look-alikes, repeated characters).
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})

const censor = new TextCensor().setStrategy(asteriskCensorStrategy())

// Phrases the matcher flags that we want to allow through (Scunthorpe problem).
// Compared case-insensitively against the whole trimmed input. Seed as needed
// when legitimate values get wrongly rejected.
const ALLOW = new Set<string>()

/** True when the text contains disallowed language (used to reject identity fields). */
export function hasProfanity(text: string): boolean {
  if (!text) return false
  if (ALLOW.has(text.trim().toLowerCase())) return false
  return matcher.hasMatch(text)
}

/** Replace any matched profanity with asterisks (used to sanitize comments). */
export function censorProfanity(text: string): string {
  if (!text) return text
  const matches = matcher.getAllMatches(text)
  if (!matches.length) return text
  return censor.applyTo(text, matches)
}
