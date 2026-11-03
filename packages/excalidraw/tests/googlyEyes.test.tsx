import React from "react";
import { vi } from "vitest";

import { exportToCanvas } from "@excalidraw/utils";

import {
  KEYS,
  MIME_TYPES,
  reseed,
  sceneCoordsToViewportCoords,
} from "@excalidraw/common";

import { CaptureUpdateAction } from "@excalidraw/element";

import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  actionAddToLibrary,
  actionDuplicateSelection,
  actionFlipHorizontal,
  actionToggleGooglyEyes,
} from "../actions";
import { createPasteEvent, serializeAsClipboardJSON } from "../clipboard";
import { loadFromBlob, parseLibraryJSON } from "../data/blob";
import { serializeAsJSON, serializeLibraryAsJSON } from "../data/json";
import { restoreElements } from "../data/restore";
import { Excalidraw } from "../index";
import * as StaticScene from "../renderer/staticScene";
import { exportToSvg } from "../scene/export";

import { API } from "./helpers/api";
import { Keyboard, Pointer } from "./helpers/ui";
import {
  act,
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

import type { LibraryItems } from "../types";

vi.mock("@excalidraw/common", async (importOriginal) => {
  const module = await importOriginal<typeof import("@excalidraw/common")>();
  const { mockThrottleRAF } = await import("./helpers/mocks");

  return {
    __esmodule: true,
    ...module,
    isDarwin: false,
    KEYS: {
      ...module.KEYS,
      CTRL_OR_CMD: "ctrlKey",
    },
    throttleRAF: mockThrottleRAF,
  };
});

const { h } = window;

const mouse = new Pointer("mouse");
const touch = new Pointer("touch");

const renderStaticScene = vi.spyOn(StaticScene, "renderStaticScene");

const ITEM = "toggleGooglyEyes";

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const withEyes = <T extends ExcalidrawElement>(
  element: T,
  customData: Record<string, any> = {},
): T => ({ ...element, customData: { ...customData, googlyEyes: true } });

/** puts the elements on the board without a history entry */
const setScene = (elements: readonly ExcalidrawElement[]) => {
  API.updateScene({
    elements,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
};

const getElement = (id: string) =>
  h.app.scene.getElementsMapIncludingDeleted().get(id)!;

const toViewport = (sceneX: number, sceneY: number) =>
  sceneCoordsToViewportCoords({ sceneX, sceneY }, h.state);

/** right-clicks the center of the element (scene coordinates) */
const rightClickOn = (element: ExcalidrawElement) => {
  const [x1, y1, x2, y2] =
    element.type === "freedraw" ||
    element.type === "arrow" ||
    element.type === "line"
      ? [element.x, element.y, element.x + 100, element.y + 100]
      : [
          element.x,
          element.y,
          element.x + element.width,
          element.y + element.height,
        ];
  const { x, y } = toViewport((x1 + x2) / 2, (y1 + y2) / 2);
  fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
    button: 2,
    clientX: x,
    clientY: y,
  });
};

const openElementMenu = (
  selection: NonDeletedExcalidrawElement[],
  target: ExcalidrawElement = selection[0],
) => {
  API.setSelectedElements(selection);
  rightClickOn(target);
  const contextMenu = GlobalTestState.renderResult.container.querySelector(
    ".context-menu",
  ) as HTMLElement | null;
  expect(contextMenu).not.toBeNull();
  return contextMenu!;
};

const queryItem = (contextMenu: HTMLElement) =>
  contextMenu.querySelector<HTMLLIElement>(`li[data-testid="${ITEM}"]`);

const getItemLabel = (contextMenu: HTMLElement) =>
  queryItem(contextMenu)?.querySelector(".context-menu-item__label")
    ?.textContent ?? null;

const createShape = (
  type: "rectangle" | "diamond" | "ellipse" | "freedraw" | "image",
  props: { x?: number; y?: number; width?: number; height?: number } = {},
) => {
  if (type === "freedraw") {
    return API.createElement({
      type,
      x: props.x ?? 0,
      y: props.y ?? 0,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(50, 100),
        pointFrom<LocalPoint>(100, 0),
      ],
    });
  }
  return API.createElement({
    type,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...props,
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getGooglyEyesCanvas = () =>
  GlobalTestState.renderResult.container.querySelector<HTMLCanvasElement>(
    "canvas.googly-eyes",
  )!;

type CanvasEvent = { type: string; props: any };

const getGooglyEyesEvents = (): CanvasEvent[] =>
  (getGooglyEyesCanvas().getContext("2d") as any).__getEvents();

const clearGooglyEyesEvents = () =>
  (getGooglyEyesCanvas().getContext("2d") as any).__clearEvents();

type Circle = { x: number; y: number; radius: number };

/** the eyes the overlay painted last: [white, pupil, glint] per eye */
const getPaintedEyes = (eyeCount = 2) => {
  const arcs: Circle[] = getGooglyEyesEvents()
    .filter((event) => event.type === "arc")
    .map(({ props: { x, y, radius } }) => ({ x, y, radius }));
  const last = arcs.slice(-eyeCount * 3);
  if (last.length < eyeCount * 3) {
    return null;
  }
  const eyes = [];
  for (let i = 0; i < eyeCount; i++) {
    const [white, pupil, glint] = last.slice(i * 3, i * 3 + 3);
    eyes.push({
      white,
      pupil,
      glint,
      offset: { x: pupil.x - white.x, y: pupil.y - white.y },
    });
  }
  return eyes;
};

/** an eyed 200x100 rectangle at (100, 100): r = 16, travel ≈ 7 */
const setupEyedRectangle = async () => {
  const rectangle = withEyes(
    API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    }),
  );
  setScene([rectangle]);
  await waitFor(() => expect(getPaintedEyes()).not.toBeNull());
  return rectangle;
};

// -----------------------------------------------------------------------------

beforeEach(async () => {
  unmountComponent();
  localStorage.clear();
  renderStaticScene.mockClear();
  reseed(7);
  mouse.reset();
  touch.reset();

  await render(<Excalidraw autoFocus={true} handleKeyboardGlobally={true} />);
  // jsdom gives the editor no size, which culls every element
  API.setAppState({ width: 800, height: 600 });
});

describe("googly eyes context menu item", () => {
  it.each(["rectangle", "diamond", "ellipse", "freedraw", "image"] as const)(
    "shows 'Add googly eyes' for a %s, without a shortcut",
    (type) => {
      const element = createShape(type);
      setScene([element]);

      const contextMenu = openElementMenu([element]);

      const item = queryItem(contextMenu);
      expect(item).not.toBeNull();
      expect(getItemLabel(contextMenu)).toBe("Add googly eyes");
      expect(
        item!.querySelector(".context-menu-item__shortcut")!.textContent,
      ).toBe("");
    },
  );

  it.each([
    ["text", () => API.createElement({ type: "text", text: "hello" })],
    ["arrow", () => API.createElement({ type: "arrow" })],
    ["line", () => API.createElement({ type: "line" })],
    ["frame", () => API.createElement({ type: "frame" })],
    [
      "embeddable",
      () => API.createElement({ type: "embeddable", width: 200, height: 100 }),
    ],
  ])("shows no item for a %s", (_, create) => {
    const element = create();
    setScene([element]);

    const contextMenu = openElementMenu([element as any]);

    expect(contextMenu.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(queryItem(contextMenu)).toBeNull();
  });

  it("shows no item for an ineligible element that carries the flag", () => {
    const arrow = withEyes(API.createElement({ type: "arrow" }));
    setScene([arrow]);

    expect(queryItem(openElementMenu([arrow]))).toBeNull();
  });

  it("reads 'Remove googly eyes' on a shape that has eyes", () => {
    const rectangle = withEyes(createShape("rectangle"));
    setScene([rectangle]);

    expect(getItemLabel(openElementMenu([rectangle]))).toBe(
      "Remove googly eyes",
    );
  });

  it("reads 'Add googly eyes' while one selected shape has no eyes", () => {
    const eyed = withEyes(createShape("rectangle"));
    const plain = createShape("ellipse", { x: 150 });
    setScene([eyed, plain]);

    expect(getItemLabel(openElementMenu([eyed, plain]))).toBe(
      "Add googly eyes",
    );
  });

  it("reads 'Remove googly eyes' when every eligible selected shape has eyes", () => {
    const eyed = withEyes(createShape("rectangle"));
    const otherEyed = withEyes(createShape("diamond", { x: 150 }));
    const arrow = API.createElement({ type: "arrow", x: 0, y: 150 });
    setScene([eyed, otherEyed, arrow]);

    expect(getItemLabel(openElementMenu([eyed, otherEyed, arrow]))).toBe(
      "Remove googly eyes",
    );
  });

  it("shows the item for a mixed selection holding one eligible shape", () => {
    const rectangle = createShape("rectangle");
    const arrow = API.createElement({ type: "arrow", x: 150, y: 0 });
    setScene([rectangle, arrow]);

    expect(getItemLabel(openElementMenu([rectangle, arrow]))).toBe(
      "Add googly eyes",
    );
  });

  it("sits in its own group right after flip vertical", () => {
    const rectangle = createShape("rectangle");
    setScene([rectangle]);

    const contextMenu = openElementMenu([rectangle]);
    const item = queryItem(contextMenu)!;

    const before = item.previousElementSibling!;
    expect(before.tagName).toBe("HR");
    expect(before.previousElementSibling?.getAttribute("data-testid")).toBe(
      "flipVertical",
    );
    expect(
      before.previousElementSibling?.previousElementSibling?.getAttribute(
        "data-testid",
      ),
    ).toBe("flipHorizontal");

    const after = item.nextElementSibling!;
    expect(after.tagName).toBe("HR");
    expect(after.nextElementSibling?.tagName).toBe("LI");
  });

  it("is absent from the canvas menu", () => {
    const rectangle = withEyes(createShape("rectangle"));
    setScene([rectangle]);
    API.clearSelection();

    const { x, y } = toViewport(600, 500);
    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: x,
      clientY: y,
    });

    const contextMenu = GlobalTestState.renderResult.container.querySelector(
      ".context-menu",
    ) as HTMLElement;
    expect(contextMenu).not.toBeNull();
    // the canvas menu, not the element one
    expect(contextMenu.querySelector('li[data-testid="selectAll"]')).not.toBe(
      null,
    );
    expect(queryItem(contextMenu)).toBeNull();
  });

  it("is absent from the element menu in view mode", () => {
    const filled = { backgroundColor: "#ffc9c9", fillStyle: "solid" } as const;
    const rectangle = withEyes(
      API.createElement({ type: "rectangle", width: 100, ...filled }),
    );
    const plain = API.createElement({
      type: "ellipse",
      x: 150,
      y: 0,
      width: 100,
      ...filled,
    });
    setScene([rectangle, plain]);
    API.setAppState({ viewModeEnabled: true });

    for (const element of [rectangle, plain]) {
      rightClickOn(element);
      const contextMenu = GlobalTestState.renderResult.container.querySelector(
        ".context-menu",
      ) as HTMLElement;
      expect(contextMenu).not.toBeNull();
      // the element menu, not the canvas one
      expect(contextMenu.querySelector('li[data-testid="copy"]')).not.toBe(
        null,
      );
      expect(queryItem(contextMenu)).toBeNull();
    }
  });

  it("adds, then removes, the eyes when clicked", () => {
    const rectangle = createShape("rectangle");
    setScene([rectangle]);

    fireEvent.click(queryItem(openElementMenu([rectangle]))!);
    expect(getElement(rectangle.id).customData).toEqual({ googlyEyes: true });
    expect(
      GlobalTestState.renderResult.container.querySelector(".context-menu"),
    ).toBeNull();

    const contextMenu = openElementMenu([getElement(rectangle.id) as any]);
    expect(getItemLabel(contextMenu)).toBe("Remove googly eyes");
    fireEvent.click(queryItem(contextMenu)!);
    expect(getElement(rectangle.id).customData).toBeUndefined();
  });

  it("shows on a touch long press", async () => {
    // filled, so that pressing its middle hits it
    const rectangle = API.createElement({
      type: "rectangle",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
    });
    setScene([rectangle]);

    const { x, y } = toViewport(150, 150);
    touch.downAt(x, y);

    const contextMenu = await waitFor(
      () => {
        const menu = GlobalTestState.renderResult.container.querySelector(
          ".context-menu",
        ) as HTMLElement;
        expect(menu).not.toBeNull();
        return menu;
      },
      { timeout: 2000 },
    );
    touch.upAt(x, y);
    expect(getItemLabel(contextMenu)).toBe("Add googly eyes");
  });
});

describe("actionToggleGooglyEyes", () => {
  it("adds eyes to one shape and bumps its version", () => {
    const rectangle = createShape("rectangle");
    setScene([rectangle]);
    API.setSelectedElements([rectangle]);
    const { version } = getElement(rectangle.id);

    API.executeAction(actionToggleGooglyEyes);

    const updated = getElement(rectangle.id);
    expect(updated.customData).toEqual({ googlyEyes: true });
    expect(updated.version).toBeGreaterThan(version);
  });

  it("removes eyes from one shape, clearing the key, and bumps its version", () => {
    const rectangle = withEyes(createShape("rectangle"));
    setScene([rectangle]);
    API.setSelectedElements([rectangle]);
    const { version, versionNonce } = getElement(rectangle.id);

    API.executeAction(actionToggleGooglyEyes);

    const updated = getElement(rectangle.id);
    expect(updated.customData).toBeUndefined();
    expect(updated.version).toBeGreaterThan(version);
    expect(updated.versionNonce).not.toBe(versionNonce);
  });

  it("keeps the other custom data keys", () => {
    const rectangle = {
      ...createShape("rectangle"),
      customData: { owner: "alice", tags: ["a", "b"] },
    };
    setScene([rectangle]);
    API.setSelectedElements([rectangle]);

    API.executeAction(actionToggleGooglyEyes);
    expect(getElement(rectangle.id).customData).toEqual({
      owner: "alice",
      tags: ["a", "b"],
      googlyEyes: true,
    });

    API.executeAction(actionToggleGooglyEyes);
    expect(getElement(rectangle.id).customData).toEqual({
      owner: "alice",
      tags: ["a", "b"],
    });
  });

  it("adds eyes to several shapes", () => {
    const shapes = [
      createShape("rectangle"),
      createShape("diamond", { x: 150 }),
      createShape("ellipse", { x: 300 }),
      createShape("freedraw", { x: 450 }),
      createShape("image", { x: 600 }),
    ];
    setScene(shapes);
    API.setSelectedElements(shapes);

    API.executeAction(actionToggleGooglyEyes);

    for (const shape of shapes) {
      expect(getElement(shape.id).customData).toEqual({ googlyEyes: true });
    }
  });

  it("removes eyes from several shapes", () => {
    const shapes = [
      withEyes(createShape("rectangle")),
      withEyes(createShape("ellipse", { x: 150 }), { owner: "bob" }),
    ];
    setScene(shapes);
    API.setSelectedElements(shapes);
    const versions = shapes.map((shape) => getElement(shape.id).version);

    API.executeAction(actionToggleGooglyEyes);

    expect(getElement(shapes[0].id).customData).toBeUndefined();
    expect(getElement(shapes[1].id).customData).toEqual({ owner: "bob" });
    shapes.forEach((shape, index) =>
      expect(getElement(shape.id).version).toBeGreaterThan(versions[index]),
    );
  });

  it("adds eyes to the shapes without, leaving the eyed ones untouched", () => {
    const eyed = withEyes(createShape("rectangle"), { owner: "carol" });
    const plain = createShape("ellipse", { x: 150 });
    setScene([eyed, plain]);
    API.setSelectedElements([eyed, plain]);
    const eyedBefore = getElement(eyed.id);
    const plainVersion = getElement(plain.id).version;

    API.executeAction(actionToggleGooglyEyes);

    const eyedAfter = getElement(eyed.id);
    expect(eyedAfter.customData).toEqual({ owner: "carol", googlyEyes: true });
    expect(eyedAfter.version).toBe(eyedBefore.version);
    expect(eyedAfter.versionNonce).toBe(eyedBefore.versionNonce);
    expect(getElement(plain.id).customData).toEqual({ googlyEyes: true });
    expect(getElement(plain.id).version).toBeGreaterThan(plainVersion);
  });

  it("acts only on the eligible elements of a mixed selection", () => {
    const rectangle = createShape("rectangle");
    const arrow = API.createElement({ type: "arrow", x: 150, y: 0 });
    const text = API.createElement({ type: "text", text: "hi", x: 0, y: 150 });
    setScene([rectangle, arrow, text]);
    API.setSelectedElements([rectangle, arrow, text]);
    const arrowBefore = getElement(arrow.id);
    const textBefore = getElement(text.id);

    API.executeAction(actionToggleGooglyEyes);

    expect(getElement(rectangle.id).customData).toEqual({ googlyEyes: true });
    expect(getElement(arrow.id)).toBe(arrowBefore);
    expect(getElement(arrow.id).customData).toBeUndefined();
    expect(getElement(text.id)).toBe(textBefore);

    // removing also leaves the ineligible elements alone
    API.executeAction(actionToggleGooglyEyes);
    expect(getElement(rectangle.id).customData).toBeUndefined();
    expect(getElement(arrow.id)).toBe(arrowBefore);
    expect(getElement(text.id)).toBe(textBefore);
  });

  it("does not touch the label of a selected container", () => {
    const [container, label] = API.createTextContainer();
    setScene([container, label]);
    API.setSelectedElements([container]);
    const labelBefore = getElement(label.id);

    API.executeAction(actionToggleGooglyEyes);

    expect(getElement(container.id).customData).toEqual({ googlyEyes: true });
    expect(getElement(label.id)).toBe(labelBefore);
  });

  it("leaves unselected shapes alone", () => {
    const selected = createShape("rectangle");
    const other = createShape("rectangle", { x: 200 });
    setScene([selected, other]);
    API.setSelectedElements([selected]);
    const otherBefore = getElement(other.id);

    API.executeAction(actionToggleGooglyEyes);

    expect(getElement(selected.id).customData).toEqual({ googlyEyes: true });
    expect(getElement(other.id)).toBe(otherBefore);
  });

  it("does nothing, and records no history, for ineligible elements only", () => {
    const arrow = API.createElement({ type: "arrow" });
    setScene([arrow]);
    API.setSelectedElements([arrow]);
    const before = getElement(arrow.id);
    const undoStackLength = API.getUndoStack().length;

    API.executeAction(actionToggleGooglyEyes);

    expect(getElement(arrow.id)).toBe(before);
    expect(API.getUndoStack().length).toBe(undoStackLength);
  });
});

describe("googly eyes history", () => {
  it("adding is one undo step, and redo brings the eyes back", () => {
    const rectangle = createShape("rectangle");
    const ellipse = createShape("ellipse", { x: 150 });
    setScene([rectangle, ellipse]);
    API.setSelectedElements([rectangle, ellipse]);
    const undoStackLength = API.getUndoStack().length;

    API.executeAction(actionToggleGooglyEyes);
    expect(API.getUndoStack().length).toBe(undoStackLength + 1);

    Keyboard.undo();
    expect(getElement(rectangle.id).customData).toBeUndefined();
    expect(getElement(ellipse.id).customData).toBeUndefined();
    expect(getElement(rectangle.id).isDeleted).toBe(false);
    expect(API.getUndoStack().length).toBe(undoStackLength);
    expect(API.getRedoStack().length).toBe(1);

    Keyboard.redo();
    expect(getElement(rectangle.id).customData).toEqual({ googlyEyes: true });
    expect(getElement(ellipse.id).customData).toEqual({ googlyEyes: true });
    expect(API.getUndoStack().length).toBe(undoStackLength + 1);
    expect(API.getRedoStack().length).toBe(0);
  });

  it("removing is one undo step, and redo removes them again", () => {
    const rectangle = withEyes(createShape("rectangle"), { owner: "dave" });
    const ellipse = withEyes(createShape("ellipse", { x: 150 }));
    setScene([rectangle, ellipse]);
    API.setSelectedElements([rectangle, ellipse]);
    const undoStackLength = API.getUndoStack().length;

    API.executeAction(actionToggleGooglyEyes);
    expect(API.getUndoStack().length).toBe(undoStackLength + 1);
    expect(getElement(rectangle.id).customData).toEqual({ owner: "dave" });
    expect(getElement(ellipse.id).customData).toBeUndefined();

    Keyboard.undo();
    expect(getElement(rectangle.id).customData).toEqual({
      owner: "dave",
      googlyEyes: true,
    });
    expect(getElement(ellipse.id).customData).toEqual({ googlyEyes: true });
    expect(API.getUndoStack().length).toBe(undoStackLength);

    Keyboard.redo();
    expect(getElement(rectangle.id).customData).toEqual({ owner: "dave" });
    expect(getElement(ellipse.id).customData).toBeUndefined();
  });

  it("add then remove are two undo steps", () => {
    const rectangle = createShape("rectangle");
    setScene([rectangle]);
    API.setSelectedElements([rectangle]);
    const undoStackLength = API.getUndoStack().length;

    API.executeAction(actionToggleGooglyEyes);
    API.executeAction(actionToggleGooglyEyes);
    expect(API.getUndoStack().length).toBe(undoStackLength + 2);
    expect(getElement(rectangle.id).customData).toBeUndefined();

    Keyboard.undo();
    expect(getElement(rectangle.id).customData).toEqual({ googlyEyes: true });
    Keyboard.undo();
    expect(getElement(rectangle.id).customData).toBeUndefined();
    Keyboard.redo();
    expect(getElement(rectangle.id).customData).toEqual({ googlyEyes: true });
  });
});

describe("googly eyes persistence", () => {
  beforeEach(() => {
    Object.assign(document, {
      elementFromPoint: () => GlobalTestState.canvas,
    });
  });

  it("survive JSON serialization and load", async () => {
    const rectangle = withEyes(createShape("rectangle"), { owner: "erin" });
    const plain = createShape("ellipse", { x: 150 });

    const json = serializeAsJSON([rectangle, plain], h.state, {}, "local");
    expect(JSON.parse(json).elements[0].customData).toEqual({
      owner: "erin",
      googlyEyes: true,
    });

    const { elements } = await loadFromBlob(
      new Blob([json], { type: MIME_TYPES.excalidraw }),
      null,
      null,
    );
    expect(elements.find((e) => e.id === rectangle.id)!.customData).toEqual({
      owner: "erin",
      googlyEyes: true,
    });
    expect(elements.find((e) => e.id === plain.id)!.customData).toBe(undefined);
  });

  it("survive restoreElements", () => {
    const shapes = (
      ["rectangle", "diamond", "ellipse", "freedraw", "image"] as const
    ).map((type, index) => withEyes(createShape(type, { x: index * 150 })));

    const restored = restoreElements(JSON.parse(JSON.stringify(shapes)), null);
    restored.forEach((element) =>
      expect(element.customData).toEqual({ googlyEyes: true }),
    );
  });

  it("survive loading the scene into the editor", async () => {
    const rectangle = withEyes(createShape("rectangle"));
    const json = serializeAsJSON([rectangle], h.state, {}, "local");

    unmountComponent();
    await render(
      <Excalidraw
        initialData={loadFromBlob(
          new Blob([json], { type: MIME_TYPES.excalidraw }),
          null,
          null,
        )}
      />,
    );

    await waitFor(() =>
      expect(getElement(rectangle.id)?.customData).toEqual({
        googlyEyes: true,
      }),
    );
  });

  it("survive copy and paste", async () => {
    const rectangle = withEyes(createShape("rectangle"));
    setScene([rectangle]);
    API.setSelectedElements([rectangle]);

    const clipboardData = new DataTransfer();
    document.dispatchEvent(
      Object.assign(new Event("copy", { bubbles: true, cancelable: true }), {
        clipboardData,
      }),
    );
    const copied = await waitFor(() => {
      const text = clipboardData.getData("text/plain");
      expect(text).not.toBe("");
      return text;
    });
    expect(JSON.parse(copied).elements[0].customData).toEqual({
      googlyEyes: true,
    });

    document.dispatchEvent(
      createPasteEvent({ types: { "text/plain": copied } }),
    );

    await waitFor(() => expect(h.elements.length).toBe(2));
    const pasted = h.elements.find((e) => e.id !== rectangle.id)!;
    expect(pasted.customData).toEqual({ googlyEyes: true });
  });

  it("survive pasting serialized clipboard JSON", async () => {
    const rectangle = withEyes(createShape("rectangle"), { owner: "frank" });
    const clipboardJSON = await serializeAsClipboardJSON({
      elements: [rectangle],
      files: null,
    });

    document.dispatchEvent(
      createPasteEvent({ types: { "text/plain": clipboardJSON } }),
    );

    await waitFor(() => expect(h.elements.length).toBe(1));
    expect(h.elements[0].customData).toEqual({
      owner: "frank",
      googlyEyes: true,
    });
  });

  it("survive duplicate (action and Ctrl+D)", () => {
    const rectangle = withEyes(createShape("rectangle"));
    setScene([rectangle]);
    API.setSelectedElements([rectangle]);

    API.executeAction(actionDuplicateSelection);
    expect(h.elements.length).toBe(2);
    h.elements.forEach((element) =>
      expect(element.customData).toEqual({ googlyEyes: true }),
    );

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.D);
    });
    expect(h.elements.length).toBe(3);
    h.elements.forEach((element) =>
      expect(element.customData).toEqual({ googlyEyes: true }),
    );
    expect(new Set(h.elements.map((element) => element.id)).size).toBe(3);
  });

  it("the duplicate's eyes are its own", () => {
    const rectangle = withEyes(createShape("rectangle"));
    setScene([rectangle]);
    API.setSelectedElements([rectangle]);
    API.executeAction(actionDuplicateSelection);
    const duplicate = h.elements.find((e) => e.id !== rectangle.id)!;

    // removing the duplicate's eyes leaves the original's
    API.setSelectedElements([duplicate as any]);
    API.executeAction(actionToggleGooglyEyes);

    expect(getElement(duplicate.id).customData).toBeUndefined();
    expect(getElement(rectangle.id).customData).toEqual({ googlyEyes: true });
  });

  it("survive library serialization", () => {
    const rectangle = withEyes(createShape("rectangle"));
    const libraryItems: LibraryItems = [
      {
        id: "googly",
        status: "unpublished",
        elements: [rectangle],
        created: 0,
      },
    ];

    const [item] = parseLibraryJSON(serializeLibraryAsJSON(libraryItems));
    expect(item.elements[0].customData).toEqual({ googlyEyes: true });
  });

  it("survive adding to the library and inserting from it", async () => {
    const rectangle = withEyes(createShape("rectangle"));
    setScene([rectangle]);
    API.setSelectedElements([rectangle]);

    API.executeAction(actionAddToLibrary);
    const libraryItems = await waitFor(async () => {
      const items = await h.app.library.getLatestLibrary();
      expect(items.length).toBe(1);
      return items;
    });
    expect(libraryItems[0].elements[0].customData).toEqual({
      googlyEyes: true,
    });

    await API.drop([
      {
        kind: "string",
        value: JSON.stringify({ itemIds: [libraryItems[0].id] }),
        type: MIME_TYPES.excalidrawlibIds,
      },
    ]);

    await waitFor(() => expect(h.elements.length).toBe(2));
    const inserted = h.elements.find((e) => e.id !== rectangle.id)!;
    expect(inserted.customData).toEqual({ googlyEyes: true });

    await act(() => h.app.library.resetLibrary());
  });
});

describe("googly eyes export", () => {
  const SVG_OPTIONS = {
    exportBackground: false,
    exportPadding: 10,
    viewBackgroundColor: "#ffffff",
  };

  const circleAttrs = (circle: Element) => ({
    cx: Number(circle.getAttribute("cx")),
    cy: Number(circle.getAttribute("cy")),
    r: Number(circle.getAttribute("r")),
    fill: circle.getAttribute("fill"),
    stroke: circle.getAttribute("stroke"),
  });

  it("draws the eyes of an eyed rectangle, pupils centered", async () => {
    const rectangle = withEyes(
      API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
      }),
    );

    const svg = await exportToSvg([rectangle], SVG_OPTIONS, null);

    const groups = svg.querySelectorAll("g.googly-eyes");
    expect(groups).toHaveLength(1);
    const circles = Array.from(groups[0].querySelectorAll("circle")).map(
      circleAttrs,
    );
    expect(circles).toHaveLength(6);

    const [
      leftWhite,
      leftPupil,
      leftGlint,
      rightWhite,
      rightPupil,
      rightGlint,
    ] = circles;
    // r = 16% of 100; at 40% of the height; r * 1.12 each side of the center;
    // shifted by the export padding
    for (const white of [leftWhite, rightWhite]) {
      expect(white.r).toBeCloseTo(16, 1);
      expect(white.cy).toBeCloseTo(10 + 40, 1);
      expect(white.fill).toBe("#ffffff");
      expect(white.stroke).toBe("#1e1e1e");
    }
    expect(leftWhite.cx).toBeCloseTo(10 + 100 - 16 * 1.12, 1);
    expect(rightWhite.cx).toBeCloseTo(10 + 100 + 16 * 1.12, 1);

    for (const [white, pupil, glint] of [
      [leftWhite, leftPupil, leftGlint],
      [rightWhite, rightPupil, rightGlint],
    ]) {
      expect(pupil.cx).toBe(white.cx);
      expect(pupil.cy).toBe(white.cy);
      expect(pupil.r).toBeCloseTo(16 * 0.48, 1);
      expect(pupil.fill).toBe("#1e1e1e");
      expect(glint.fill).toBe("#ffffff");
      expect(glint.cx).toBeLessThan(pupil.cx);
      expect(glint.cy).toBeLessThan(pupil.cy);
    }
  });

  it("draws the eyes after their element and below its label", async () => {
    const [container, label] = API.createTextContainer({
      label: { text: "label" },
    });
    const eyed = withEyes(container);

    const svg = await exportToSvg([eyed, label], SVG_OPTIONS, null);

    const eyes = svg.querySelector("g.googly-eyes")!;
    const text = svg.querySelector("text")!;
    expect(eyes).not.toBeNull();
    expect(text).not.toBeNull();
    expect(
      eyes.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // the rectangle's own drawing comes before its eyes
    const rectanglePath = svg.querySelector("path")!;
    expect(
      rectanglePath.compareDocumentPosition(eyes) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("draws one pair per eyed shape, none for the others", async () => {
    const elements = [
      withEyes(createShape("rectangle")),
      createShape("rectangle", { x: 150 }),
      withEyes(createShape("ellipse", { x: 300 })),
      withEyes(createShape("diamond", { x: 450 })),
    ];

    const svg = await exportToSvg(elements, SVG_OPTIONS, null);

    const groups = svg.querySelectorAll("g.googly-eyes");
    expect(groups).toHaveLength(3);
    groups.forEach((group) =>
      expect(group.querySelectorAll("circle")).toHaveLength(6),
    );
  });

  it("draws no eyes for a shape without the flag", async () => {
    const svg = await exportToSvg(
      [createShape("rectangle"), createShape("ellipse", { x: 150 })],
      SVG_OPTIONS,
      null,
    );
    expect(svg.querySelector("g.googly-eyes")).toBeNull();
  });

  it("draws no eyes for an ineligible element carrying the flag", async () => {
    const svg = await exportToSvg(
      [
        withEyes(API.createElement({ type: "arrow" })),
        withEyes(API.createElement({ type: "line", x: 150 })),
        withEyes(API.createElement({ type: "text", text: "hi", y: 150 })),
      ],
      SVG_OPTIONS,
      null,
    );
    expect(svg.querySelector("g.googly-eyes")).toBeNull();
  });

  it("keeps the eye colors in a dark mode export", async () => {
    const svg = await exportToSvg(
      [withEyes(createShape("rectangle"))],
      { ...SVG_OPTIONS, exportWithDarkMode: true },
      null,
    );
    const [white, pupil, glint] = Array.from(
      svg.querySelectorAll("g.googly-eyes circle"),
    ).map(circleAttrs);
    expect(white.fill).toBe("#ffffff");
    expect(white.stroke).toBe("#1e1e1e");
    expect(pupil.fill).toBe("#1e1e1e");
    expect(glint.fill).toBe("#ffffff");
  });

  it("applies the element opacity to the eyes", async () => {
    const svg = await exportToSvg(
      [withEyes(API.createElement({ type: "rectangle", opacity: 50 }))],
      SVG_OPTIONS,
      null,
    );
    expect(svg.querySelector("g.googly-eyes")!.getAttribute("opacity")).toBe(
      "0.5",
    );
  });

  it("draws the eyes of a rotated shape where the shape points", async () => {
    const rectangle = withEyes(
      API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        angle: Math.PI,
      }),
    );
    const svg = await exportToSvg([rectangle], SVG_OPTIONS, null);
    const [leftWhite, , , rightWhite] = Array.from(
      svg.querySelectorAll("g.googly-eyes circle"),
    ).map(circleAttrs);
    // upside down: the eyes sit at 60% of the height
    expect(leftWhite.cy).toBeCloseTo(10 + 60, 1);
    expect(rightWhite.cy).toBeCloseTo(10 + 60, 1);
  });

  it("exports an eyed shape to canvas with the eyes, pupils centered", async () => {
    const rectangle = withEyes(
      API.createElement({
        type: "rectangle",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
      }),
    );

    const canvas = await exportToCanvas({
      elements: [rectangle],
      files: null,
      exportPadding: 0,
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
    });

    const arcs = ((canvas.getContext("2d") as any).__getEvents() as any[])
      .filter((event) => event.type === "arc")
      .map(({ props: { x, y, radius } }) => ({ x, y, radius }));
    expect(arcs).toHaveLength(6);
    const [leftWhite, leftPupil, , rightWhite, rightPupil] = arcs;
    expect(leftWhite.radius).toBeCloseTo(16);
    expect(rightWhite.radius).toBeCloseTo(16);
    expect(leftWhite.y).toBeCloseTo(40);
    expect(rightWhite.x - leftWhite.x).toBeCloseTo(2 * 16 * 1.12);
    for (const [white, pupil] of [
      [leftWhite, leftPupil],
      [rightWhite, rightPupil],
    ]) {
      // centered
      expect(pupil.x).toBe(white.x);
      expect(pupil.y).toBe(white.y);
      expect(pupil.radius).toBeCloseTo(16 * 0.48);
    }
  });

  it("exports to canvas without eyes for plain shapes", async () => {
    const canvas = await exportToCanvas({
      elements: [createShape("rectangle")],
      files: null,
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
    });
    const arcs = (
      (canvas.getContext("2d") as any).__getEvents() as any[]
    ).filter((event) => event.type === "arc");
    expect(arcs).toHaveLength(0);
  });
});

describe("googly eyes overlay", () => {
  it("is a canvas between the static and the interactive canvases", () => {
    const canvas = getGooglyEyesCanvas();
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(
      GlobalTestState.canvas.compareDocumentPosition(canvas) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      canvas.compareDocumentPosition(GlobalTestState.interactiveCanvas) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not draw the eyes on the static canvas in the editor", async () => {
    await setupEyedRectangle();
    const staticEvents = (
      GlobalTestState.canvas.getContext("2d") as any
    ).__getEvents() as CanvasEvent[];
    expect(
      staticEvents.filter(
        (event) =>
          event.type === "arc" && Math.abs(event.props.radius - 16) < 1e-6,
      ),
    ).toHaveLength(0);
  });

  it("paints the eyes where the shape is, looking down before the pointer moves", async () => {
    await setupEyedRectangle();

    const eyes = getPaintedEyes()!;
    expect(eyes[0].white.radius).toBeCloseTo(16);
    expect(eyes[0].white.y).toBeCloseTo(100 + 40);
    expect((eyes[0].white.x + eyes[1].white.x) / 2).toBeCloseTo(200);
    for (const eye of eyes) {
      expect(eye.offset.x).toBeCloseTo(0);
      expect(eye.offset.y).toBeGreaterThan(0);
      expect(eye.offset.y + eye.pupil.radius).toBeLessThan(eye.white.radius);
    }
  });

  it("moves the pupils toward the pointer", async () => {
    await setupEyedRectangle();

    // far to the right of the shape
    const right = toViewport(780, 150);
    mouse.moveTo(right.x, right.y);
    await waitFor(() => {
      for (const eye of getPaintedEyes()!) {
        expect(eye.offset.x).toBeGreaterThan(5);
        expect(Math.abs(eye.offset.y)).toBeLessThan(1);
      }
    });

    // far above it
    const above = toViewport(200, -500);
    mouse.moveTo(above.x, above.y);
    await waitFor(() => {
      for (const eye of getPaintedEyes()!) {
        expect(eye.offset.y).toBeLessThan(-5);
        expect(Math.abs(eye.offset.x)).toBeLessThan(1);
      }
    });

    // never outside the white
    for (const eye of getPaintedEyes()!) {
      expect(
        Math.hypot(eye.offset.x, eye.offset.y) + eye.pupil.radius,
      ).toBeLessThan(eye.white.radius);
    }
  });

  it("keeps the pupils inside the white while they spring", async () => {
    await setupEyedRectangle();

    for (const [x, y] of [
      [5000, 140],
      [-5000, 140],
      [200, 5000],
      [200, -5000],
    ]) {
      const { x: clientX, y: clientY } = toViewport(x, y);
      mouse.moveTo(clientX, clientY);
      // let a few frames run
      await sleep(40);
    }
    await waitFor(() => expect(getPaintedEyes()![0].offset.y).toBeLessThan(-5));

    const arcs = getGooglyEyesEvents()
      .filter((event) => event.type === "arc")
      .map(({ props }) => props);
    expect(arcs.length).toBeGreaterThan(6);
    for (let i = 0; i + 2 < arcs.length; i += 3) {
      const [white, pupil] = [arcs[i], arcs[i + 1]];
      expect(
        Math.hypot(pupil.x - white.x, pupil.y - white.y) + pupil.radius,
      ).toBeLessThan(white.radius);
    }
  });

  it("travels further when the pointer is farther", async () => {
    await setupEyedRectangle();
    const eye = getPaintedEyes()![1].white;

    /** the pupil's offset once the spring has settled */
    const settledOffset = async () => {
      await waitFor(() =>
        expect(Math.abs(getPaintedEyes()![1].offset.y)).toBeLessThan(0.05),
      );
      await sleep(300);
      return getPaintedEyes()![1].offset.x;
    };

    // half an eye width away
    const near = toViewport(eye.x + 16, eye.y);
    mouse.moveTo(near.x, near.y);
    const nearOffset = await settledOffset();

    // an eye width away
    const middle = toViewport(eye.x + 32, eye.y);
    mouse.moveTo(middle.x, middle.y);
    const middleOffset = await settledOffset();

    // a dozen eye widths away
    const far = toViewport(eye.x + 400, eye.y);
    mouse.moveTo(far.x, far.y);
    const farOffset = await settledOffset();

    expect(nearOffset).toBeGreaterThan(0);
    expect(middleOffset).toBeGreaterThan(nearOffset);
    expect(farOffset).toBeGreaterThan(middleOffset);
    // full travel, still inside the white
    const { white, pupil } = getPaintedEyes()![1];
    expect(farOffset + pupil.radius).toBeLessThan(white.radius);
    expect(farOffset + pupil.radius).toBeGreaterThan(white.radius - 3);
  });

  it("follows the pointer in view mode", async () => {
    await setupEyedRectangle();
    API.setAppState({ viewModeEnabled: true });

    const left = toViewport(-500, 140);
    mouse.moveTo(left.x, left.y);
    await waitFor(() => {
      for (const eye of getPaintedEyes()!) {
        expect(eye.offset.x).toBeLessThan(-5);
      }
    });
  });

  it("follows the last touch point", async () => {
    await setupEyedRectangle();

    const left = toViewport(-500, 140);
    touch.downAt(left.x, left.y);
    touch.upAt(left.x, left.y);
    await waitFor(() => {
      for (const eye of getPaintedEyes()!) {
        expect(eye.offset.x).toBeLessThan(-5);
      }
    });
  });

  it("follows the shape when it moves, resizes and rotates", async () => {
    const rectangle = await setupEyedRectangle();
    const before = getPaintedEyes()!;

    API.updateElement(getElement(rectangle.id), { x: 400, y: 300 });
    await waitFor(() => {
      const after = getPaintedEyes()!;
      expect(after[0].white.x - before[0].white.x).toBeCloseTo(300);
      expect(after[0].white.y - before[0].white.y).toBeCloseTo(200);
    });

    // 300 x 150 at (400, 300): r = 24, eyes at 40% of the height
    API.updateElement(getElement(rectangle.id), { width: 300, height: 150 });
    await waitFor(() => {
      const after = getPaintedEyes()!;
      expect(after[0].white.radius).toBeCloseTo(24);
      expect(after[0].white.y).toBeCloseTo(300 + 150 * 0.4);
      expect((after[0].white.x + after[1].white.x) / 2).toBeCloseTo(550);
    });

    // a quarter turn: the upper middle is now on the right side
    API.updateElement(getElement(rectangle.id), {
      angle: (Math.PI / 2) as any,
    });
    await waitFor(() => {
      const after = getPaintedEyes()!;
      expect(after[0].white.x).toBeCloseTo(after[1].white.x);
      // center (550, 375), 15 (= 75 - 60) right of it
      expect(after[0].white.x).toBeCloseTo(550 + 15);
      expect(Math.abs(after[0].white.y - after[1].white.y)).toBeCloseTo(
        2 * 24 * 1.12,
      );
    });
  });

  it("follows the shape when it flips", async () => {
    // a tilted rectangle: its flip mirrors the eyes around its center
    const rectangle = withEyes(
      API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        angle: Math.PI / 6,
      }),
    );
    setScene([rectangle]);
    await waitFor(() => expect(getPaintedEyes()).not.toBeNull());
    const centers = (eyes: ReturnType<typeof getPaintedEyes>) =>
      eyes!
        .map(({ white }) => ({ x: white.x, y: white.y }))
        .sort((a, b) => a.y - b.y);
    const before = centers(getPaintedEyes());

    API.setSelectedElements([rectangle]);
    API.executeAction(actionFlipHorizontal);

    await waitFor(() => {
      const after = centers(getPaintedEyes());
      // mirrored around the vertical axis through the center (x = 200)
      after.forEach((center, index) => {
        expect(center.x).toBeCloseTo(400 - before[index].x);
        expect(center.y).toBeCloseTo(before[index].y);
      });
    });
  });

  it("stops painting the eyes once removed", async () => {
    const rectangle = await setupEyedRectangle();
    API.setSelectedElements([rectangle]);

    clearGooglyEyesEvents();
    API.executeAction(actionToggleGooglyEyes);

    await waitFor(() =>
      expect(
        getGooglyEyesEvents().some((event) => event.type === "clearRect"),
      ).toBe(true),
    );
    clearGooglyEyesEvents();
    const { x, y } = toViewport(700, 500);
    mouse.moveTo(x, y);
    await sleep(50);
    expect(
      getGooglyEyesEvents().filter((event) => event.type === "arc"),
    ).toHaveLength(0);
  });

  it("keeps its colors in the dark theme", async () => {
    await setupEyedRectangle();
    clearGooglyEyesEvents();
    API.setAppState({ theme: "dark" });

    const fills = await waitFor(() => {
      let fillStyle: string | null = null;
      const colors: string[] = [];
      for (const event of getGooglyEyesEvents()) {
        if (event.type === "fillStyle") {
          fillStyle = String(event.props.value).toLowerCase();
        } else if (event.type === "fill") {
          colors.push(fillStyle!);
        }
      }
      expect(colors.length).toBeGreaterThanOrEqual(6);
      return colors.slice(-6);
    });
    expect(fills).toEqual([
      "#ffffff",
      "#1e1e1e",
      "#ffffff",
      "#ffffff",
      "#1e1e1e",
      "#ffffff",
    ]);
    const strokeStyles = getGooglyEyesEvents()
      .filter((event) => event.type === "strokeStyle")
      .map((event) => String(event.props.value).toLowerCase());
    expect(strokeStyles.length).toBeGreaterThan(0);
    strokeStyles.forEach((color) => expect(color).toBe("#1e1e1e"));
  });

  it("hides the part of the eyes a shape on top covers", async () => {
    const eyed = withEyes(
      API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
      }),
    );
    const cover = API.createElement({
      type: "rectangle",
      x: 150,
      y: 110,
      width: 100,
      height: 60,
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
    });
    setScene([eyed, cover]);

    await waitFor(() =>
      expect(
        getGooglyEyesEvents().some(
          (event) =>
            event.type === "globalCompositeOperation" &&
            event.props.value === "destination-out",
        ),
      ).toBe(true),
    );
  });

  it("does not erase the eyes for a shape below or beside them", async () => {
    const below = API.createElement({
      type: "rectangle",
      x: 150,
      y: 110,
      width: 100,
      height: 60,
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
    });
    const eyed = withEyes(
      API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
      }),
    );
    const beside = API.createElement({
      type: "rectangle",
      x: 500,
      y: 400,
      width: 100,
      height: 60,
    });
    setScene([below, eyed, beside]);
    await waitFor(() => expect(getPaintedEyes()).not.toBeNull());

    expect(
      getGooglyEyesEvents().some(
        (event) =>
          event.type === "globalCompositeOperation" &&
          event.props.value === "destination-out",
      ),
    ).toBe(false);
  });

  it("pointer moves repaint only the eyes, never the static scene", async () => {
    // 50 eyed shapes on a 10 x 5 grid
    const shapes = Array.from({ length: 50 }, (_, index) =>
      withEyes(
        API.createElement({
          type: (["rectangle", "ellipse", "diamond"] as const)[index % 3],
          x: 20 + (index % 10) * 75,
          y: 20 + Math.floor(index / 10) * 75,
          width: 60,
          height: 60,
        }),
      ),
    );
    setScene(shapes);
    await waitFor(() => expect(getPaintedEyes(100)).not.toBeNull());
    const versions = shapes.map((shape) => getElement(shape.id).version);

    renderStaticScene.mockClear();
    clearGooglyEyesEvents();

    for (const [x, y] of [
      [10, 10],
      [400, 200],
      [790, 590],
      [50, 500],
      [420, 230],
    ]) {
      const { x: clientX, y: clientY } = toViewport(x, y);
      mouse.moveTo(clientX, clientY);
    }

    // the last pointer (420, 230) is below every row's eyes
    await waitFor(() => {
      const eyes = getPaintedEyes(100)!;
      expect(eyes).not.toBeNull();
      // every eye of the top row looks down toward the pointer
      for (const eye of eyes.slice(0, 20)) {
        expect(eye.offset.y).toBeGreaterThan(0.5);
      }
    });

    expect(renderStaticScene).not.toHaveBeenCalled();
    // the pointer is not stored on the elements (nor synced through them)
    shapes.forEach((shape, index) =>
      expect(getElement(shape.id).version).toBe(versions[index]),
    );

    // control: the spy does see a static re-render
    API.setAppState({ viewBackgroundColor: "#fff9db" });
    expect(renderStaticScene).toHaveBeenCalled();
  });
});
