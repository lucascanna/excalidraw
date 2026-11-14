/** how many emoji the picker's "Recently used" group keeps (two rows) */
export const RECENT_EMOJIS_LIMIT = 14;

// one emoji: a pictographic code point, a regional indicator (flags) or a
// keycap. Sequences are short; anything longer is not an emoji we stamp.
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
const MAX_EMOJI_LENGTH = 32;

export const isEmojiValue = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_EMOJI_LENGTH &&
  EMOJI_RE.test(value);

/** moves `emoji` to the front of the recent list */
export const addRecentEmoji = (
  recentEmojis: readonly string[],
  emoji: string,
): readonly string[] =>
  [emoji, ...recentEmojis.filter((item) => item !== emoji)].slice(
    0,
    RECENT_EMOJIS_LIMIT,
  );

/** drops malformed persisted recent emoji (imported data is untrusted) */
export const restoreRecentEmojis = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const emojis = new Set<string>();
  for (const item of value) {
    if (isEmojiValue(item)) {
      emojis.add(item);
    }
    if (emojis.size >= RECENT_EMOJIS_LIMIT) {
      break;
    }
  }
  return [...emojis];
};
