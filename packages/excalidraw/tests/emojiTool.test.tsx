import React from "react";

import { KEYS, MIME_TYPES } from "@excalidraw/common";
import { getCommonBounds, getElementAbsoluteCoords } from "@excalidraw/element";

import type { ExcalidrawImageElement, FileId } from "@excalidraw/element/types";
import type { Radians } from "@excalidraw/math";

import { Excalidraw } from "../index";
import { actionToggleCropEditor } from "../actions/actionCropEditor";
import { actionSendToBack } from "../actions/actionZindex";
import {
  cleanAppStateForExport,
  clearAppStateForDatabase,
  clearAppStateForLocalStorage,
} from "../appState";
import { getShapeActionPredicates } from "../components/shapeActionPredicates";
import { getLinkHandleFromCoords } from "../components/hyperlink/helpers";
import { loadFromBlob } from "../data/blob";
import { serializeAsJSON } from "../data/json";
import { restoreAppState } from "../data/restore";
import { getNormalizedZoom } from "../scene";

import { exportToSvg } from "../scene/export";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import {
  act,
  fireEvent,
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  screen,
  waitFor,
  within,
} from "./test-utils";

import type { ExcalidrawProps } from "../types";

const { h } = window;
const mouse = new Pointer("mouse");
const emoji = "🎉";
const recent = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😅",
  "😂",
  "🤣",
  "😊",
  "😇",
  "🙂",
  "🙃",
  "😉",
  "😍",
];
const generateIdForFile = vi.fn(async (_file: File) => "emoji-png" as FileId);
const onLinkOpen = vi.fn<NonNullable<ExcalidrawProps["onLinkOpen"]>>(
  (_element, event) => event.preventDefault(),
);
const canvas = () => GlobalTestState.interactiveCanvas;
const tiles = () =>
  Array.from(
    h.app.ownerDocument.querySelectorAll<HTMLButtonElement>(
      ".emoji-picker__button",
    ),
  );
const liveElements = () => h.elements.filter((element) => !element.isDeleted);
const stamp = () => liveElements()[0] as ExcalidrawImageElement;
const geometry = () => {
  const { x, y, width, height, angle } = stamp();
  return { x, y, width, height, angle };
};
const openPicker = async () => {
  UI.clickTool("emoji");
  await screen.findAllByRole("button", { name: "Grinning face" });
  return screen.getByPlaceholderText("Search emoji");
};
const pick = async (value = emoji) => {
  act(() => h.app.emojiStamp.pick(value));
  // Wait for the real renderer/file preparation, not just the synchronous tool switch.
  await act(async () => {
    expect(await h.app.emojiStamp.prepareFile(value)).not.toBeNull();
  });
};
const createStamp = async () => {
  await pick();
  mouse.clickAt(200, 200);
  await waitFor(() => expect(liveElements()).toHaveLength(1));
  return stamp();
};

beforeAll(() => {
  // Radix measures the popover with ResizeObserver, which jsdom lacks.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  vi.restoreAllMocks();
  restoreOriginalGetBoundingClientRect();
});

describe("emoji tool", () => {
  beforeEach(async () => {
    generateIdForFile.mockClear();
    onLinkOpen.mockClear();
    await render(
      <Excalidraw
        handleKeyboardGlobally
        generateIdForFile={generateIdForFile}
        onLinkOpen={onLinkOpen}
      />,
    );
  });

  it("places the desktop button between Sticky note and Eraser with a J badge", () => {
    const buttons = Array.from(
      h.app.ownerDocument.querySelectorAll("[data-testid^='toolbar-']"),
    );
    const index = buttons.indexOf(screen.getByTestId("toolbar-emoji"));
    expect(buttons[index - 1]).toHaveAttribute(
      "data-testid",
      "toolbar-stickynote",
    );
    expect(buttons[index + 1]).toHaveAttribute("data-testid", "toolbar-eraser");
    expect(
      screen
        .getByTestId("toolbar-emoji")
        .querySelector(".ToolIcon__keybinding"),
    ).toHaveTextContent("J");
  });

  it.each(["hover", "focus"])(
    "shows the Excalidraw tooltip on %s and hides it on leave",
    async (mode) => {
      const button = screen.getByTestId("toolbar-emoji");
      expect(button).not.toHaveAttribute("title");
      if (mode === "hover") {
        fireEvent.pointerEnter(button);
      } else {
        // jsdom does not model keyboard focus visibility during onFocus.
        const matches = button.matches.bind(button);
        vi.spyOn(button, "matches").mockImplementation((selector) =>
          selector === ":focus-visible" ? true : matches(selector),
        );
        act(() => button.focus());
      }
      await waitFor(() =>
        expect(
          h.app.ownerDocument.querySelector(".excalidraw-tooltip--visible"),
        ).toHaveTextContent("Emoji — J"),
      );
      if (mode === "hover") {
        fireEvent.pointerLeave(button);
      } else {
        act(() => button.blur());
      }
      expect(
        h.app.ownerDocument.querySelector(".excalidraw-tooltip--visible"),
      ).toBeNull();
    },
  );

  it("lists Emoji and J in Help", () => {
    Keyboard.keyPress("?");
    const row = screen.getByText("Emoji").closest(".HelpDialog__shortcut");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("J").tagName).toBe("KBD");
  });

  it("button toggles the picker without changing the current tool", async () => {
    act(() => h.app.setActiveTool({ type: "rectangle" }));
    await openPicker();
    expect(h.state.activeTool.type).toBe("rectangle");
    expect(h.state.openPopup).toBe("emojiPicker");
    expect(screen.queryByText("Recently used")).not.toBeInTheDocument();
    UI.clickTool("emoji");
    expect(screen.queryByTestId("emoji-picker")).not.toBeInTheDocument();
    expect(h.state.activeTool.type).toBe("rectangle");
    expect(h.state.currentItemEmoji).toBeNull();
  });

  it.each(["Escape", "canvas"])(
    "%s dismisses without changing selection or elements",
    async (method) => {
      const rect = UI.createElement("rectangle", { x: 20, y: 20, size: 80 });
      const before = [...h.elements];
      const input = await openPicker();
      if (method === "Escape") {
        Keyboard.keyPress(KEYS.ESCAPE, input);
      } else {
        mouse.clickAt(500, 500);
      }
      expect(h.state.openPopup).toBeNull();
      expect(h.state.activeTool.type).toBe("selection");
      expect(h.state.selectedElementIds).toEqual({ [rect.id]: true });
      expect(h.elements).toEqual(before);
    },
  );

  it("dismissal over a link consumes its release; the next click can open the link", async () => {
    const rect = API.createElement({
      type: "rectangle",
      x: 20,
      y: 20,
      width: 120,
      height: 90,
    });
    API.setElements([rect]);
    // createElement intentionally omits link; set it through the scene API.
    API.updateElement(rect, { link: "https://example.com" });
    act(() => h.app.setActiveTool({ type: "laser" }));
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(
      rect,
      h.app.scene.getNonDeletedElementsMap(),
    );
    const [x, y, width, height] = getLinkHandleFromCoords(
      [x1, y1, x2, y2],
      rect.angle,
      h.state,
    );
    await openPicker();
    mouse.moveTo(x + width / 2, y + height / 2);
    mouse.clickAt(x + width / 2, y + height / 2);
    expect(h.state.openPopup).toBeNull();
    expect(onLinkOpen).not.toHaveBeenCalled();
    expect(h.state.activeTool.type).toBe("laser");
    expect(h.state.selectedElementIds).toEqual({});
    expect(h.elements).toEqual([rect]);
    mouse.clickAt(x + width / 2, y + height / 2);
    expect(onLinkOpen).toHaveBeenCalledTimes(1);
  });

  it("dismissal over an embed consumes release without activating the embed", async () => {
    const embed = API.createElement({
      type: "embeddable",
      x: 40,
      y: 40,
      width: 300,
      height: 180,
    });
    API.setElements([embed]);
    API.updateElement(embed, {
      link: "https://www.youtube.com/watch?v=gkGMXY0wekg",
    });
    act(() => h.app.setActiveTool({ type: "laser" }));
    await openPicker();
    mouse.moveTo(190, 130);
    // Hover is legitimate; dismissal must not change it to an active embed.
    const before = h.state.activeEmbeddable;
    expect(before?.state).toBe("hover");
    mouse.clickAt(190, 130);
    expect(h.state.openPopup).toBeNull();
    expect(h.state.activeEmbeddable).toEqual(before);
    expect(h.state.selectedElementIds).toEqual({});
    expect(h.elements).toEqual([embed]);
    mouse.clickAt(190, 130);
    await waitFor(() =>
      expect(h.state.activeEmbeddable).toMatchObject({
        element: { id: embed.id },
        state: "active",
      }),
    );
  });

  it("dismissal while armed does not stamp, but the next canvas click does", async () => {
    await pick();
    await openPicker();
    mouse.clickAt(200, 200);
    expect(liveElements()).toHaveLength(0);
    expect(h.state.activeTool.type).toBe("emoji");
    mouse.clickAt(300, 300);
    expect(liveElements()).toHaveLength(1);
    expect(stamp()).toMatchObject({ x: 260, y: 260 });
  });

  it("search matches names, reports empty results, and Enter picks the first match", async () => {
    const input = await openPicker();
    fireEvent.change(input, { target: { value: "heart" } });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Red heart" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Broken heart" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Smiling face with heart-eyes" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Grinning face" }),
    ).not.toBeInTheDocument();
    expect(
      tiles().every((tile) =>
        tile.getAttribute("aria-label")!.toLowerCase().includes("heart"),
      ),
    ).toBe(true);
    fireEvent.change(input, { target: { value: "qwerty" } });
    expect(await screen.findByText("No emoji found")).toBeInTheDocument();
    expect(tiles()).toHaveLength(0);
    Keyboard.keyPress(KEYS.ENTER, input);
    expect(h.state.activeTool.type).toBe("selection");
    fireEvent.change(input, { target: { value: "rocket" } });
    await screen.findByRole("button", { name: "Rocket" });
    Keyboard.keyPress(KEYS.ENTER, input);
    expect(h.state.currentItemEmoji).toBe("🚀");
    expect(h.state.activeTool.type).toBe("emoji");
    expect(h.state.openPopup).toBeNull();
    await act(async () => {
      await h.app.emojiStamp.prepareFile("🚀");
    });
  });

  it("ArrowDown enters the tiles and horizontal arrows navigate without editor shortcuts", async () => {
    const input = await openPicker();
    const [first, second] = tiles();
    Keyboard.keyPress(KEYS.ARROW_DOWN, input);
    expect(first).toHaveFocus();
    Keyboard.keyPress(KEYS.ARROW_RIGHT, first);
    expect(second).toHaveFocus();
    Keyboard.keyPress(KEYS.ARROW_LEFT, second);
    expect(first).toHaveFocus();
    Keyboard.keyPress(KEYS.ARROW_LEFT, first);
    expect(input).toHaveFocus();
    expect(h.state.activeTool.type).toBe("selection");
  });

  it("picking arms, updates the button/cursor/hint, and deduplicates/caps recent emoji", async () => {
    API.setAppState({ recentEmojis: recent });
    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Party popper" }));
    await act(async () => {
      await h.app.emojiStamp.prepareFile(emoji);
    });
    expect(h.state.currentItemEmoji).toBe(emoji);
    expect(h.state.activeTool.type).toBe("emoji");
    expect(h.state.openPopup).toBeNull();
    expect(h.state.recentEmojis).toEqual([emoji, ...recent.slice(0, 13)]);
    expect(screen.getByTestId("toolbar-emoji")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("toolbar-emoji")).toHaveTextContent(emoji);
    expect(canvas().style.cursor).toContain("url(");
    expect(h.app.ownerDocument.querySelector(".HintViewer")).toHaveTextContent(
      "Click to stamp the emoji, or press Escape to stop",
    );
    await openPicker();
    expect(screen.getByText("Recently used")).toBeInTheDocument();
    expect(tiles()[0]).toHaveAttribute("data-testid", `emoji-picker-${emoji}`);
    fireEvent.click(tiles()[0]);
    expect(h.state.recentEmojis).toEqual([emoji, ...recent.slice(0, 13)]);
  });

  it("rearms with another emoji and Escape stops stamping", async () => {
    await pick();
    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Rocket" }));
    await act(async () => {
      await h.app.emojiStamp.prepareFile("🚀");
    });
    expect(screen.getByTestId("toolbar-emoji")).toHaveTextContent("🚀");
    mouse.clickAt(200, 200);
    expect(stamp().customData).toEqual({ emoji: "🚀" });
    await pick();
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.state.activeTool.type).toBe("selection");
    mouse.clickAt(500, 500);
    expect(liveElements()).toHaveLength(1);
  });

  it.each([1, 2.5])(
    "stamps an 80 scene-unit image at zoom %s, centered on pointer down",
    async (zoom) => {
      API.setAppState({
        zoom: { value: getNormalizedZoom(zoom) },
        scrollX: 0,
        scrollY: 0,
        currentItemOpacity: 60,
      });
      await pick();
      mouse.downAt(200, 200);
      expect(liveElements()).toHaveLength(0);
      mouse.moveTo(220, 230);
      mouse.upAt();
      expect(liveElements()).toHaveLength(1);
      expect(stamp()).toMatchObject({
        type: "image",
        customData: { emoji },
        width: 80,
        height: 80,
        x: 200 / zoom - 40,
        y: 200 / zoom - 40,
        opacity: 60,
      });
      expect(h.state.selectedElementIds).toEqual({ [stamp().id]: true });
      expect(h.state.activeTool.type).toBe("selection");
      expect(h.app.files[stamp().fileId!]).toMatchObject({
        id: "emoji-png",
        mimeType: MIME_TYPES.png,
        dataURL: expect.stringMatching(/^data:image\/png;base64,/),
      });
      expect(generateIdForFile).toHaveBeenCalledTimes(1);
      expect(generateIdForFile.mock.calls[0][0]).toMatchObject({
        type: MIME_TYPES.png,
        name: "emoji.png",
      });
    },
  );

  it("locked tool stamps repeatedly without selecting and reuses its PNG", async () => {
    UI.clickTool("lock");
    await pick();
    for (const x of [100, 300, 500]) {
      mouse.clickAt(x, 200);
      expect(h.state.activeTool.type).toBe("emoji");
      expect(h.state.selectedElementIds).toEqual({});
    }
    expect(liveElements()).toHaveLength(3);
    expect(liveElements().map((element) => element.x)).toEqual([60, 260, 460]);
    expect(Object.keys(h.app.files)).toHaveLength(1);
    expect(generateIdForFile).toHaveBeenCalledTimes(1);
  });

  it("touch tap stamps only on release", async () => {
    await pick();
    const touch = new Pointer("touch", 10);
    touch.downAt(200, 200);
    expect(liveElements()).toHaveLength(0);
    touch.upAt();
    expect(liveElements()).toHaveLength(1);
    expect(stamp()).toMatchObject({ x: 160, y: 160, width: 80, height: 80 });
  });

  it.each(["pointercancel", "second touch", "context menu", "tool switch"])(
    "%s during the press aborts the stamp",
    async (reason) => {
      await pick();
      const event = {
        clientX: 200,
        clientY: 200,
        button: 0,
        pointerId: 10,
        pointerType: "touch",
      };
      fireEvent.pointerDown(canvas(), event);
      expect(liveElements()).toHaveLength(0);
      if (reason === "pointercancel") {
        fireEvent.pointerCancel(canvas(), event);
      } else if (reason === "second touch") {
        fireEvent.pointerDown(canvas(), {
          ...event,
          clientX: 250,
          pointerId: 11,
        });
        fireEvent.pointerUp(canvas(), {
          ...event,
          clientX: 250,
          pointerId: 11,
        });
      } else if (reason === "context menu") {
        fireEvent.contextMenu(canvas(), event);
      } else {
        act(() => h.app.setActiveTool({ type: "selection" }));
      }
      fireEvent.pointerUp(canvas(), event);
      expect(liveElements()).toHaveLength(0);
    },
  );

  it.each([1, 2])("mouse button %s cannot stamp", async (button) => {
    await pick();
    const event = {
      clientX: 200,
      clientY: 200,
      button,
      pointerId: 1,
      pointerType: "mouse",
    };
    fireEvent.pointerDown(canvas(), event);
    fireEvent.pointerUp(canvas(), event);
    expect(liveElements()).toHaveLength(0);
  });

  it.each([false, true])(
    "corner resize keeps proportions unless Shift is held (%s)",
    async (shift) => {
      await createStamp();
      UI.resize(stamp(), "se", [80, 30], { shift });
      expect(stamp().width).toBeGreaterThan(80);
      if (shift) {
        expect(stamp().width).not.toBe(stamp().height);
      } else {
        expect(stamp().width).toBeCloseTo(stamp().height);
      }
    },
  );

  it("Alt resizes from the center and Shift rotation snaps to 15 degrees", async () => {
    await createStamp();
    UI.resize(stamp(), "se", [80, 30], { alt: true });
    expect(stamp().width).toBeGreaterThan(80);
    expect(stamp().x + stamp().width / 2).toBeCloseTo(200);
    expect(stamp().y + stamp().height / 2).toBeCloseTo(200);
    UI.rotate(stamp(), [75, 50], { shift: true });
    expect(stamp().angle).not.toBe(0);
    const steps = stamp().angle / (Math.PI / 12);
    expect(steps).toBeCloseTo(Math.round(steps));
  });

  it("undo/redo removes and restores a newly stamped element", async () => {
    const element = await createStamp();
    const before = geometry();
    Keyboard.undo();
    expect(liveElements()).toHaveLength(0);
    Keyboard.redo();
    expect(liveElements()).toHaveLength(1);
    expect(stamp().id).toBe(element.id);
    expect(geometry()).toEqual(before);
    expect(stamp().customData).toEqual({ emoji });
    expect(h.app.files[stamp().fileId!]).toBeDefined();
  });

  it("undo/redo steps through move, resize, and rotation", async () => {
    await createStamp();
    const states = [geometry()];
    mouse.downAt(200, 200);
    mouse.moveTo(250, 230);
    mouse.upAt();
    expect(stamp()).toMatchObject({ x: 210, y: 190, width: 80, height: 80 });
    states.push(geometry());
    UI.resize(stamp(), "se", [80, 40]);
    expect(stamp().width).toBeGreaterThan(80);
    states.push(geometry());
    UI.rotate(stamp(), [80, 40]);
    expect(stamp().angle).not.toBe(0);
    states.push(geometry());
    for (const expected of states.slice(0, -1).reverse()) {
      Keyboard.undo();
      expect(geometry()).toEqual(expected);
    }
    for (const expected of states.slice(1)) {
      Keyboard.redo();
      expect(geometry()).toEqual(expected);
    }
  });

  it("supports opacity, layers, duplicate, link and delete", async () => {
    const rect = UI.createElement("rectangle", { x: 50, y: 50, size: 40 });
    await pick();
    mouse.clickAt(200, 200);
    const image = liveElements()[1] as ExcalidrawImageElement;
    fireEvent.change(screen.getByTestId("opacity"), {
      target: { value: "50" },
    });
    expect(API.getElement(image).opacity).toBe(50);
    API.executeAction(actionSendToBack);
    expect(liveElements().map((element) => element.id)).toEqual([
      image.id,
      rect.id,
    ]);
    Keyboard.withModifierKeys({ ctrl: true }, () => Keyboard.keyPress("d"));
    expect(liveElements()).toHaveLength(3);
    const duplicate = API.getSelectedElement() as ExcalidrawImageElement;
    expect(duplicate.id).not.toBe(image.id);
    expect(duplicate).toMatchObject({
      type: "image",
      customData: { emoji },
      opacity: 50,
      fileId: image.fileId,
    });
    Keyboard.withModifierKeys({ ctrl: true }, () => Keyboard.keyPress("k"));
    const input = h.app.ownerDocument.querySelector<HTMLInputElement>(
      ".excalidraw-hyperlinkContainer input",
    )!;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "https://example.com" } });
    Keyboard.keyPress(KEYS.ENTER, input);
    expect(API.getElement(duplicate).link).toBe("https://example.com");
    Keyboard.keyPress(KEYS.DELETE);
    expect(liveElements().map((element) => element.id)).toEqual([
      image.id,
      rect.id,
    ]);
  });

  it.each(["Enter", "double click"])(
    "%s cannot crop a stamp but can crop a normal image",
    async (method) => {
      await createStamp();
      const predicates = () =>
        getShapeActionPredicates(
          h.state,
          [stamp()],
          h.app.scene.getNonDeletedElementsMap(),
          h.app,
        );
      expect(predicates().cropEditor).toBe(false);
      expect(
        actionToggleCropEditor.predicate!(
          h.elements,
          h.state,
          h.app.props,
          h.app,
        ),
      ).toBe(false);
      expect(
        h.app.ownerDocument.querySelector(".HintViewer")?.textContent ?? "",
      ).not.toMatch(/crop/i);
      const enterCrop = () =>
        method === "Enter"
          ? Keyboard.keyPress(KEYS.ENTER)
          : mouse.doubleClickAt(200, 200);
      enterCrop();
      expect(h.state.croppingElementId).toBeNull();
      // Double-click falls through to text editing for a non-croppable stamp.
      // Discard that state before exercising the normal image crop path.
      API.setAppState({
        editingTextElement: null,
        selectedElementIds: { [stamp().id]: true },
      });
      // mutateElement ignores undefined updates; an empty object removes the marker.
      API.updateElement(stamp(), { customData: {} });
      expect(predicates().cropEditor).toBe(true);
      enterCrop();
      expect(h.state.croppingElementId).toBe(stamp().id);
    },
  );

  it("save/open and browser restore preserve geometry, opacity, metadata and the PNG", async () => {
    await createStamp();
    API.updateElement(stamp(), {
      x: 123,
      y: 234,
      width: 160,
      height: 120,
      angle: (Math.PI / 6) as Radians,
      opacity: 50,
    });
    const expected = {
      ...geometry(),
      opacity: 50,
      customData: { emoji },
      fileId: stamp().fileId,
    };
    const files = { ...h.app.files };
    const json = serializeAsJSON(h.elements, h.state, files, "local");
    const opened = await loadFromBlob(
      new Blob([json], { type: MIME_TYPES.excalidraw }),
      null,
      null,
    );
    expect(opened.elements).toHaveLength(1);
    expect(opened.elements[0]).toMatchObject(expected);
    expect(opened.files).toEqual(files);
    const stored = JSON.parse(
      JSON.stringify({
        elements: h.elements,
        appState: clearAppStateForLocalStorage(h.state),
        files,
      }),
    );
    GlobalTestState.renderResult.unmount();
    await render(<Excalidraw initialData={stored} />);
    expect(stamp()).toMatchObject(expected);
    expect(h.app.files).toEqual(files);
    expect(h.state.currentItemEmoji).toBe(emoji);
    expect(h.state.recentEmojis).toEqual([emoji]);
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "SVG export keeps PNG and transform (background=%s, dark=%s)",
    async (exportBackground, exportWithDarkMode) => {
      await createStamp();
      API.updateElement(stamp(), {
        width: 160,
        height: 120,
        angle: (Math.PI / 6) as Radians,
        opacity: 50,
      });
      const elements = h.app.scene.getNonDeletedElements();
      const svg = await exportToSvg(
        elements,
        { ...h.state, exportBackground, exportWithDarkMode, exportPadding: 10 },
        h.app.files,
      );
      const image = svg.querySelector("image")!;
      expect(image).not.toBeNull();
      expect(image.getAttribute("href")).toBe(
        h.app.files[stamp().fileId!].dataURL,
      );
      const use = svg.querySelector("use")!;
      expect(use).toHaveAttribute("href", `#image-${stamp().fileId}`);
      expect(use).toHaveAttribute("width", "160");
      expect(use).toHaveAttribute("height", "120");
      expect(use).toHaveAttribute("opacity", "0.5");
      const [minX, minY] = getCommonBounds(elements);
      const transform = use.parentElement!.getAttribute("transform")!;
      const numbers = transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(transform).toMatch(/^translate\(.+\) rotate\(.+\)$/);
      expect(numbers[0]).toBeCloseTo(stamp().x - minX + 10);
      expect(numbers[1]).toBeCloseTo(stamp().y - minY + 10);
      expect(numbers[2]).toBeCloseTo(30);
      expect(numbers.slice(3)).toEqual([80, 60]);
      expect(use.parentElement).not.toHaveAttribute("filter");
    },
  );
});

describe("restoring emoji preferences", () => {
  it.each([null, 123, {}, [], "", "not an emoji", "😀".repeat(20)])(
    "drops malformed currentItemEmoji %j",
    (value) => {
      expect(
        restoreAppState({ currentItemEmoji: value } as any, null)
          .currentItemEmoji,
      ).toBeNull();
    },
  );

  it.each([null, 123, {}, "😀"])("drops non-array recentEmojis %j", (value) => {
    expect(
      restoreAppState({ recentEmojis: value } as any, null).recentEmojis,
    ).toEqual([]);
  });

  it.each(["imported", "local"])(
    "sanitizes %s preferences, caps/deduplicates recents and never restores the emoji tool",
    (source) => {
      const state = {
        currentItemEmoji: emoji,
        recentEmojis: [
          null,
          "",
          12,
          {},
          "bad",
          "😀".repeat(20),
          emoji,
          emoji,
          "🇮🇹",
          "1️⃣",
          ...recent,
        ],
        activeTool: { type: "emoji", locked: true },
      };
      const restored =
        source === "imported"
          ? restoreAppState(state as any, null)
          : restoreAppState(null, state as any);
      expect(restored.currentItemEmoji).toBe(emoji);
      expect(restored.recentEmojis).toEqual([
        emoji,
        "🇮🇹",
        "1️⃣",
        ...recent.slice(0, 11),
      ]);
      expect(restored.activeTool.type).toBe("selection");
    },
  );

  it("persists preferences only to browser storage", () => {
    const state = { currentItemEmoji: emoji, recentEmojis: [emoji] };
    expect(clearAppStateForLocalStorage(state)).toMatchObject(state);
    for (const clean of [cleanAppStateForExport, clearAppStateForDatabase]) {
      expect(clean(state)).not.toHaveProperty("currentItemEmoji");
      expect(clean(state)).not.toHaveProperty("recentEmojis");
    }
  });
});

// Mocked measurements verify responsive branching, not physical layout or placement.
describe("emoji on phones", () => {
  it.each([390, 320])(
    "opens the picker from the appropriate toolbar slot at %s px",
    async (width) => {
      mockBoundingClientRect({
        // Bottom bar: viewport minus 28px; Island: 4px padding per side.
        width: width - 36,
        height: width === 390 ? 844 : 640,
      });
      await render(<Excalidraw generateIdForFile={generateIdForFile} />);
      act(() => {
        h.app.refreshEditorInterface();
        h.app.refresh();
      });
      expect(h.app.editorInterface.formFactor).toBe("phone");
      const toolbar = h.app.ownerDocument.querySelector(".mobile-toolbar")!;
      const more = toolbar.querySelector<HTMLButtonElement>(
        ".App-toolbar__extra-tools-trigger",
      )!;
      if (width === 390) {
        expect(
          within(toolbar as HTMLElement).getByTestId("toolbar-emoji"),
        ).toBeInTheDocument();
        expect(
          within(toolbar as HTMLElement).queryByTestId("toolbar-text"),
        ).not.toBeInTheDocument();
      } else {
        expect(
          within(toolbar as HTMLElement).queryByTestId("toolbar-emoji"),
        ).not.toBeInTheDocument();
        fireEvent.click(more);
      }
      UI.clickTool("emoji");
      await screen.findByRole("button", { name: "Party popper" });
      expect(
        h.app.ownerDocument.querySelector(".emoji-picker-popover--bottom-bar"),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Party popper" }));
      await act(async () => {
        await h.app.emojiStamp.prepareFile(emoji);
      });
      if (width === 320) {
        expect(more).toHaveTextContent(emoji);
      }
      const touch = new Pointer("touch", 15);
      touch.clickAt(150, 200);
      expect(stamp()).toMatchObject({
        customData: { emoji },
        width: 80,
        height: 80,
      });
    },
  );
});
