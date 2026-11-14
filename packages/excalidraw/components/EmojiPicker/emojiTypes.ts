export type EmojiGroupId =
  | "smileys"
  | "people"
  | "animals"
  | "food"
  | "travel"
  | "activities"
  | "objects"
  | "symbols"
  | "flags";

/** an emoji and its Unicode CLDR short name (lowercase) */
export type EmojiEntry = readonly [emoji: string, name: string];

export type EmojiGroupData = {
  id: EmojiGroupId;
  emoji: readonly EmojiEntry[];
};
