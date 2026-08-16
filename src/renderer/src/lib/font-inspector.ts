export function filterFontCodePoints(codePoints: number[], query: string): number[] {
  if (!query.trim()) return codePoints
  const available = new Set(codePoints)
  return parseCharacterQuery(query).filter((codePoint) => available.has(codePoint))
}

export function parseCharacterQuery(value: string): number[] {
  const notationMatches = [...value.matchAll(/(?:U\+|0x)([0-9a-f]{1,6})/giu)]
  const codePoints = notationMatches.length
    ? notationMatches.map((match) => Number.parseInt(match[1], 16))
    : [...value].map((character) => character.codePointAt(0)!)
  return [...new Set(codePoints.filter(isUnicodeScalar))]
}

export function formatUnicode(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}

function isUnicodeScalar(value: number): boolean {
  return value >= 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff)
}
