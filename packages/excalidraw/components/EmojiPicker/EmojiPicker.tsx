import clsx from "clsx";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";

import { t } from "../../i18n";
import { useExcalidrawContainer } from "../App";
import { PropertiesPopover } from "../PropertiesPopover";
import { QuickSearch } from "../QuickSearch";
import { ScrollableList } from "../ScrollableList";
import DropdownMenuGroup from "../dropdownMenu/DropdownMenuGroup";

import {
  getEmojiLabel,
  getEmojiNames,
  loadEmojiGroups,
  searchEmojiGroups,
} from "./emojiList";

import "./EmojiPicker.scss";

import type { EmojiEntry, EmojiGroupData } from "./emojiTypes";

type PickerGroup = {
  key: string;
  title: string;
  emoji: readonly EmojiEntry[];
};

const noop = () => {};

/**
 * the Emoji button toggles the picker itself: pressing or focusing it must
 * not also dismiss the picker as an outside interaction
 */
const isEmojiToolButton = (target: EventTarget | null) =>
  // no `instanceof Element`: the editor may live in another document (iframe,
  // popout window), whose elements belong to another realm
  typeof (target as Element | null)?.closest === "function" &&
  !!(target as Element).closest(
    ".emoji-tool-button, [data-testid='toolbar-emoji']",
  );

/** the tile in the previous (-1) or next (1) row closest to the tile at `index` */
const getTileInAdjacentRow = (
  tiles: readonly HTMLElement[],
  index: number,
  direction: -1 | 1,
) => {
  const current = tiles[index].getBoundingClientRect();
  const centerX = current.left + current.width / 2;
  let rowTop: number | null = null;
  let closest: { tile: HTMLElement; distance: number } | null = null;

  for (let i = index + direction; i >= 0 && i < tiles.length; i += direction) {
    const rect = tiles[i].getBoundingClientRect();
    if (Math.abs(rect.top - current.top) < 1) {
      continue;
    }
    if (rowTop === null) {
      rowTop = rect.top;
    } else if (Math.abs(rect.top - rowTop) >= 1) {
      break;
    }
    const distance = Math.abs(rect.left + rect.width / 2 - centerX);
    if (!closest || distance < closest.distance) {
      closest = { tile: tiles[i], distance };
    }
  }
  return closest?.tile ?? null;
};

export const EmojiPicker = ({
  selectedEmoji,
  recentEmojis,
  onPick,
  onClose,
  placement,
}: {
  selectedEmoji: string | null;
  recentEmojis: readonly string[];
  onPick: (emoji: string) => void;
  onClose: () => void;
  /**
   * `toolbar`: under the Emoji button; `bottom-bar`: above the phone's
   * bottom bar, as wide as it
   */
  placement: "toolbar" | "bottom-bar";
}) => {
  const { container } = useExcalidrawContainer();
  const [emojiGroups, setEmojiGroups] = useState<
    readonly EmojiGroupData[] | null
  >(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadEmojiGroups().then(
      (groups) => {
        if (!cancelled) {
          setEmojiGroups(groups);
        }
      },
      (error) => {
        console.error(error);
        if (!cancelled) {
          setLoadError(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const emojiNames = useMemo(
    () => (emojiGroups ? getEmojiNames(emojiGroups) : new Map()),
    [emojiGroups],
  );

  const groups = useMemo((): readonly PickerGroup[] => {
    if (!emojiGroups) {
      return [];
    }
    const toPickerGroup = (group: EmojiGroupData): PickerGroup => ({
      key: group.id,
      title: t(`emojiPicker.groups.${group.id}`),
      emoji: group.emoji,
    });
    if (query) {
      return searchEmojiGroups(emojiGroups, query).map(toPickerGroup);
    }
    const recent: PickerGroup[] = recentEmojis.length
      ? [
          {
            key: "recent",
            title: t("emojiPicker.recentlyUsed"),
            emoji: recentEmojis.map(
              (emoji) => [emoji, emojiNames.get(emoji) ?? emoji] as const,
            ),
          },
        ]
      : [];
    return [...recent, ...emojiGroups.map(toPickerGroup)];
  }, [emojiGroups, emojiNames, query, recentEmojis]);

  const firstEmoji = groups[0]?.emoji[0]?.[0] ?? null;

  const getTiles = () =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        ".emoji-picker__button",
      ) ?? [],
    );

  const focusTile = (tile: HTMLElement | null) => {
    if (tile) {
      tile.focus();
      tile.scrollIntoView?.({ block: "nearest" });
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // the picker owns the keyboard while focused: no editor shortcuts
    event.stopPropagation();

    if (event.key === KEYS.ESCAPE) {
      event.preventDefault();
      onClose();
      return;
    }

    const target = event.target as HTMLElement;

    if (target === inputRef.current) {
      if (event.key === KEYS.ENTER) {
        event.preventDefault();
        if (firstEmoji) {
          onPick(firstEmoji);
        }
      } else if (event.key === KEYS.ARROW_DOWN) {
        event.preventDefault();
        focusTile(getTiles()[0] ?? null);
      }
      return;
    }

    const tiles = getTiles();
    const index = tiles.indexOf(target as HTMLButtonElement);
    if (index === -1) {
      return;
    }

    let next: HTMLElement | null;
    if (event.key === KEYS.ARROW_RIGHT) {
      next = tiles[index + 1] ?? null;
    } else if (event.key === KEYS.ARROW_LEFT) {
      next = tiles[index - 1] ?? inputRef.current;
    } else if (event.key === KEYS.ARROW_DOWN) {
      next = getTileInAdjacentRow(tiles, index, 1);
    } else if (event.key === KEYS.ARROW_UP) {
      next = getTileInAdjacentRow(tiles, index, -1) ?? inputRef.current;
    } else {
      return;
    }
    event.preventDefault();
    focusTile(next);
  };

  const list = useMemo(
    () =>
      groups.map((group, groupIndex) => (
        <DropdownMenuGroup key={group.key} title={group.title}>
          <div className="emoji-picker__grid">
            {group.emoji.map(([emoji, name], index) => {
              const label = getEmojiLabel(name);
              return (
                <button
                  key={emoji}
                  type="button"
                  className={clsx(
                    "color-picker__button color-picker__button--large emoji-picker__button",
                    { active: emoji === selectedEmoji },
                  )}
                  title={label}
                  aria-label={label}
                  aria-pressed={emoji === selectedEmoji}
                  data-testid={`emoji-picker-${emoji}`}
                  // one tab stop for the grid; arrow keys move within it
                  tabIndex={groupIndex === 0 && index === 0 ? 0 : -1}
                  onClick={() => onPick(emoji)}
                >
                  <span className="emoji-picker__glyph" aria-hidden="true">
                    {emoji}
                  </span>
                  <span className="color-picker__button-outline" />
                </button>
              );
            })}
          </div>
        </DropdownMenuGroup>
      )),
    [groups, selectedEmoji, onPick],
  );

  return (
    <PropertiesPopover
      className={clsx("emoji-picker-popover properties-content", {
        "emoji-picker-popover--bottom-bar": placement === "bottom-bar",
      })}
      container={container}
      side={placement === "toolbar" ? "bottom" : "top"}
      align="center"
      sideOffset={placement === "toolbar" ? 12 : 8}
      alignOffset={0}
      arrow={placement === "toolbar"}
      aria-label={t("emojiPicker.title")}
      // every close goes through the popover root's `onOpenChange`, Escape
      // or a pick. This callback runs once the old content unmounts, so it
      // must not close a picker reopened in the meantime
      onClose={noop}
      onKeyDown={onKeyDown}
      onPointerDownOutside={(event) => {
        if (isEmojiToolButton(event.target)) {
          event.preventDefault();
        }
      }}
      onFocusOutside={(event) => {
        if (isEmojiToolButton(event.target)) {
          event.preventDefault();
        }
      }}
      // no on-screen keyboard over the emoji on touch screens
      preventAutoFocusOnTouch
    >
      <div className="emoji-picker" data-testid="emoji-picker">
        <QuickSearch
          ref={inputRef}
          className="emoji-picker__search"
          placeholder={t("emojiPicker.searchPlaceholder")}
          onChange={setQuery}
        />
        <div ref={listRef}>
          <ScrollableList
            className="dropdown-menu emoji-picker__list"
            placeholder={
              loadError
                ? t("emojiPicker.loadError")
                : emojiGroups
                ? t("emojiPicker.empty")
                : t("emojiPicker.loading")
            }
          >
            {list.length ? list : null}
          </ScrollableList>
        </div>
      </div>
    </PropertiesPopover>
  );
};
