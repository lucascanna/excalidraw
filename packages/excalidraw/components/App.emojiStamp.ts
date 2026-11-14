import { getGridPoint, MIME_TYPES } from "@excalidraw/common";

import {
  CaptureUpdateAction,
  makeNextSelectedElementIds,
  newElementWith,
  newImageElement,
} from "@excalidraw/element";

import type { ExcalidrawImageElement, FileId } from "@excalidraw/element/types";

import { dataURLToFile, generateIdFromFile } from "../data/blob";
import { t } from "../i18n";

import { renderEmojiToCanvas } from "./EmojiPicker/emojiRender";
import { addRecentEmoji } from "./EmojiPicker/recentEmojis";

import type { BinaryFileData, DataURL } from "../types";
import type App from "./App";

/** the stamp's side in scene units: 80 x 80 at 100% zoom */
export const EMOJI_STAMP_SIZE = 80;

/**
 * the side of the stamp's picture in pixels: the 80-unit stamp stays sharp
 * at 400% zoom (320 CSS pixels, more on a high-density screen)
 */
const EMOJI_STAMP_RESOLUTION = 512;

/** space around the glyph, as a fraction of the picture's side */
const EMOJI_STAMP_PADDING = 0.04;

type ScenePoint = { x: number; y: number };

type StampFile = Pick<BinaryFileData, "id" | "dataURL" | "mimeType">;

/**
 * Owns the emoji tool: its picker state, and the stamps — image elements
 * whose picture is the picked emoji, rendered from the system emoji font at
 * stamp time.
 */
export class AppEmojiStamp {
  constructor(private app: App) {}

  /** the stamp picture of each emoji stamped in this session */
  private files = new Map<string, StampFile>();
  private pendingFiles = new Map<string, Promise<StampFile | null>>();

  /**
   * The click armed on pointer down, committed on pointer up, so that a
   * second finger (pinch/pan), a long-press context menu or a pointercancel
   * aborts the stamp.
   */
  private pending: ScenePoint | null = null;

  /**
   * the tool lock asked for by the activation that opened the picker
   * (`setActiveTool({ type: "emoji", locked })`), applied when a pick arms
   * the tool; `undefined` keeps the current lock
   */
  private requestedLock: boolean | undefined;

  isPickerOpen = () => this.app.state.openPopup === "emojiPicker";

  openPicker = (locked?: boolean) => {
    this.requestedLock = locked;
    this.app.setState({ openPopup: "emojiPicker", openMenu: null });
  };

  closePicker = () => {
    if (this.isPickerOpen()) {
      this.app.setState({ openPopup: null });
    }
  };

  togglePicker = (locked?: boolean) => {
    if (this.isPickerOpen()) {
      this.closePicker();
    } else {
      this.openPicker(locked);
    }
  };

  /** picks the emoji to stamp: closes the picker and arms the tool */
  pick = (emoji: string) => {
    this.app.setState((prevState) => ({
      currentItemEmoji: emoji,
      recentEmojis: addRecentEmoji(prevState.recentEmojis, emoji),
      openPopup:
        prevState.openPopup === "emojiPicker" ? null : prevState.openPopup,
    }));
    // render the picture now, so that the first click stamps at once
    void this.prepareFile(emoji);
    const locked = this.requestedLock;
    this.requestedLock = undefined;
    this.app.setActiveTool({ type: "emoji", locked }, { emojiPicked: true });
  };

  /** arms a stamp at the pointer-down position; nothing mutates yet */
  handlePointerDown = (scenePointer: ScenePoint) => {
    this.pending = scenePointer;
  };

  /** stamps the armed click, at the pointer-DOWN position */
  handlePointerUp = () => {
    const scenePointer = this.pending;
    this.pending = null;
    if (scenePointer) {
      this.stamp(scenePointer);
    }
  };

  /** aborts the armed stamp (second finger, context menu, pointercancel) */
  cancel = () => {
    this.pending = null;
  };

  /** one undoable step: the stamp, centered on the click, selected */
  private stamp = (scenePointer: ScenePoint) => {
    const emoji = this.app.state.currentItemEmoji;
    if (!emoji) {
      return;
    }
    const file = this.files.get(emoji) ?? null;
    const element = this.newStampElement(emoji, file, scenePointer);

    this.app.insertNewElements([element]);
    // with the tool locked, the next click stamps another one
    if (!this.app.isToolLocked()) {
      this.app.setState((prevState) => ({
        selectedElementIds: makeNextSelectedElementIds(
          { [element.id]: true },
          prevState,
        ),
        selectedGroupIds: {},
        editingGroupId: null,
      }));
    }

    if (file) {
      // after the element is in the scene, so that its picture gets cached
      this.addFile(file);
      this.app.scheduleCapture();
      return;
    }

    // the picture is still rendering (the pick prepares it, so only a click
    // right after the pick waits): like the image tool's placeholders, the
    // stamp waits in the scene for its file, then lands as one undoable step,
    // unless it left the scene meanwhile (deleted, or the scene replaced)
    this.prepareFile(emoji).then((file) => {
      if (this.app.unmounted) {
        return;
      }
      const placeholder = this.app.scene.getElement(element.id);
      if (!placeholder || placeholder.isDeleted) {
        return;
      }
      if (!file) {
        this.app.updateScene({
          elements: this.app.scene
            .getElementsIncludingDeleted()
            .map((el) =>
              el.id === element.id
                ? newElementWith(el, { isDeleted: true })
                : el,
            ),
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
        });
        this.app.setState({ errorMessage: t("errors.imageInsertError") });
        return;
      }
      this.app.updateScene({
        elements: this.app.scene.getElementsIncludingDeleted().map((el) =>
          el.id === element.id
            ? newElementWith(el as ExcalidrawImageElement, {
                fileId: file.id as FileId,
              })
            : el,
        ),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      this.addFile(file);
    });
  };

  private addFile = (file: StampFile) => {
    this.app.addFiles([
      { ...file, created: Date.now(), lastRetrieved: Date.now() },
    ]);
  };

  /** the stamp, centered on the click; without a file while it renders */
  private newStampElement = (
    emoji: string,
    file: StampFile | null,
    scenePointer: ScenePoint,
  ) => {
    const [x, y] = getGridPoint(
      scenePointer.x,
      scenePointer.y,
      this.app.getEffectiveGridSize(),
    );
    const frame = this.app.getTopLayerFrameAtSceneCoords({ x, y });

    return newImageElement({
      type: "image",
      x: x - EMOJI_STAMP_SIZE / 2,
      y: y - EMOJI_STAMP_SIZE / 2,
      width: EMOJI_STAMP_SIZE,
      height: EMOJI_STAMP_SIZE,
      fileId: file ? (file.id as FileId) : null,
      status: "pending",
      backgroundColor: "transparent",
      roundness: null,
      opacity: this.app.state.currentItemOpacity,
      locked: false,
      frameId: frame ? frame.id : null,
      customData: { emoji },
    });
  };

  /** the stamp picture of `emoji`, rendered once per session */
  prepareFile = (emoji: string): Promise<StampFile | null> => {
    const file = this.files.get(emoji);
    if (file) {
      return Promise.resolve(file);
    }
    let pending = this.pendingFiles.get(emoji);
    if (!pending) {
      pending = this.createFile(emoji).then(
        (file) => {
          this.pendingFiles.delete(emoji);
          this.files.set(emoji, file);
          return file;
        },
        (error) => {
          this.pendingFiles.delete(emoji);
          console.error(error);
          return null;
        },
      );
      this.pendingFiles.set(emoji, pending);
    }
    return pending;
  };

  private createFile = async (emoji: string): Promise<StampFile> => {
    const canvas = renderEmojiToCanvas(
      emoji,
      EMOJI_STAMP_RESOLUTION,
      EMOJI_STAMP_PADDING,
    );
    if (!canvas) {
      throw new Error("Couldn't render the emoji: no 2d canvas context");
    }
    const dataURL = canvas.toDataURL(MIME_TYPES.png) as DataURL;
    const file = dataURLToFile(dataURL, "emoji.png");
    // the image tool's file id: the host's, else the picture's digest
    const id = await ((this.app.props.generateIdForFile?.(
      file,
    ) as Promise<FileId>) || generateIdFromFile(file));
    if (!id) {
      throw new Error("Couldn't generate the emoji stamp's file id");
    }
    return { id, dataURL, mimeType: MIME_TYPES.png };
  };
}
