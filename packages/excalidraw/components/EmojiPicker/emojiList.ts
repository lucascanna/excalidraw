import { isTestEnv } from "@excalidraw/common";

import { EMOJI_FONT_FAMILY } from "./emojiRender";

import type { EmojiEntry, EmojiGroupData } from "./emojiTypes";

let emojiGroupsPromise: Promise<readonly EmojiGroupData[]> | null = null;

/**
 * The picker's emoji set, loaded on demand (its own chunk) the first time the
 * picker opens, then kept for the session.
 */
export const loadEmojiGroups = (): Promise<readonly EmojiGroupData[]> => {
  if (!emojiGroupsPromise) {
    emojiGroupsPromise = import("./emojiData").then(
      ({ EMOJI_GROUPS }) => keepSupportedEmoji(EMOJI_GROUPS),
      (error) => {
        // retry on the next open
        emojiGroupsPromise = null;
        throw error;
      },
    );
  }
  return emojiGroupsPromise;
};

const countEmoji = (groups: readonly EmojiGroupData[]) =>
  groups.reduce((count, group) => count + group.emoji.length, 0);

/**
 * Drops the emoji the system font can't draw as one glyph (newer emoji, or
 * flags on Windows): those render as several glyphs, so measure wider than
 * one emoji.
 */
const keepSupportedEmoji = (
  groups: readonly EmojiGroupData[],
): readonly EmojiGroupData[] => {
  // jsdom has no text metrics
  if (isTestEnv()) {
    return groups;
  }
  const context = document.createElement("canvas").getContext("2d");
  if (!context) {
    return groups;
  }
  context.font = `32px ${EMOJI_FONT_FAMILY}`;
  const referenceWidth = context.measureText("😀").width;
  if (!(referenceWidth > 0)) {
    return groups;
  }
  const supported = groups
    .map((group) => ({
      ...group,
      emoji: group.emoji.filter(([emoji]) => {
        const width = context.measureText(emoji).width;
        return width > 0 && width <= referenceWidth * 1.4;
      }),
    }))
    .filter((group) => group.emoji.length);

  // a font that measures oddly must not empty the picker
  return countEmoji(supported) >= countEmoji(groups) / 2 ? supported : groups;
};

/**
 * The emoji whose name contains every word of `query` (case-insensitive), in
 * their groups. An empty query keeps every emoji.
 */
export const searchEmojiGroups = (
  groups: readonly EmojiGroupData[],
  query: string,
): readonly EmojiGroupData[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return groups;
  }
  return groups
    .map((group) => ({
      ...group,
      emoji: group.emoji.filter(([, name]) =>
        words.every((word) => name.includes(word)),
      ),
    }))
    .filter((group) => group.emoji.length);
};

/** the emoji's name as a label: "red heart" → "Red heart" */
export const getEmojiLabel = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1);

export const getEmojiNames = (
  groups: readonly EmojiGroupData[],
): ReadonlyMap<string, string> =>
  new Map<string, string>(
    groups.flatMap((group) => group.emoji as EmojiEntry[]),
  );
