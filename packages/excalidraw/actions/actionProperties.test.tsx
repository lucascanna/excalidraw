import { fireEvent, queryByTestId, screen } from "@testing-library/react";

import {
  COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  FREEDRAW_STROKE_WIDTH,
  FONT_FAMILY,
  FONT_SIZES,
  getFontString,
  getLineHeight,
  KEYS,
  STROKE_WIDTH,
  resolvablePromise,
} from "@excalidraw/common";

import {
  isArrowElement,
  LinearElementEditor,
  measureText,
} from "@excalidraw/element";

import type {
  ExcalidrawArrowElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { t } from "../i18n";
import { API } from "../tests/helpers/api";
import { Keyboard, Pointer, UI } from "../tests/helpers/ui";
import { act, render, togglePopover } from "../tests/test-utils";

import { actionChangeFontFamily } from "./actionProperties";

describe("element locking", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  describe("properties when tool selected", () => {
    it("should show active background top picks", () => {
      UI.clickTool("rectangle");

      const color = DEFAULT_ELEMENT_BACKGROUND_PICKS[1];

      // just in case we change it in the future
      expect(color).not.toBe(COLOR_PALETTE.transparent);

      API.setAppState({
        currentItemBackgroundColor: color,
      });
      const activeColor = queryByTestId(
        document.body,
        `color-top-pick-${color}`,
      );
      expect(activeColor).toHaveClass("active");
    });

    it("should show fill style when background non-transparent", () => {
      UI.clickTool("rectangle");

      const color = DEFAULT_ELEMENT_BACKGROUND_PICKS[1];

      // just in case we change it in the future
      expect(color).not.toBe(COLOR_PALETTE.transparent);

      API.setAppState({
        currentItemBackgroundColor: color,
        currentItemFillStyle: "hachure",
      });
      const hachureFillButton = queryByTestId(document.body, `fill-hachure`);

      expect(hachureFillButton).toHaveClass("active");
      API.setAppState({
        currentItemFillStyle: "solid",
      });
      const solidFillStyle = queryByTestId(document.body, `fill-solid`);
      expect(solidFillStyle).toHaveClass("active");
    });

    it("should not show fill style when background transparent", () => {
      UI.clickTool("rectangle");

      API.setAppState({
        currentItemBackgroundColor: COLOR_PALETTE.transparent,
        currentItemFillStyle: "hachure",
      });
      const hachureFillButton = queryByTestId(document.body, `fill-hachure`);

      expect(hachureFillButton).toBe(null);
    });

    it("should not show fill style for sticky note tool", () => {
      UI.clickTool("stickynote");

      API.setAppState({
        currentItemBackgroundColor: DEFAULT_ELEMENT_BACKGROUND_PICKS[1],
        currentItemFillStyle: "hachure",
      });
      const hachureFillButton = queryByTestId(document.body, `fill-hachure`);

      expect(hachureFillButton).toBe(null);
    });

    it("should show horizontal text align for text tool", () => {
      UI.clickTool("text");

      API.setAppState({
        currentItemTextAlign: "right",
      });

      const centerTextAlign = queryByTestId(document.body, `align-right`);
      expect(centerTextAlign).toBeChecked();
    });
  });

  describe("properties when elements selected", () => {
    it("should show active styles when single element selected", () => {
      const rect = API.createElement({
        type: "rectangle",
        backgroundColor: "red",
        fillStyle: "cross-hatch",
      });
      API.setElements([rect]);
      API.setSelectedElements([rect]);

      const crossHatchButton = queryByTestId(document.body, `fill-cross-hatch`);
      expect(crossHatchButton).toHaveClass("active");
    });

    it("should not show fill style selected element's background is transparent", () => {
      const rect = API.createElement({
        type: "rectangle",
        backgroundColor: COLOR_PALETTE.transparent,
        fillStyle: "cross-hatch",
      });
      API.setElements([rect]);
      API.setSelectedElements([rect]);

      const crossHatchButton = queryByTestId(document.body, `fill-cross-hatch`);
      expect(crossHatchButton).toBe(null);
    });

    it("should not show fill style for selected sticky note", () => {
      const stickyNote = API.createElement({
        type: "stickynote",
        backgroundColor: DEFAULT_ELEMENT_BACKGROUND_PICKS[1],
        fillStyle: "hachure",
      });
      API.setElements([stickyNote]);
      API.setSelectedElements([stickyNote]);

      const hachureFillButton = queryByTestId(document.body, `fill-hachure`);
      expect(hachureFillButton).toBe(null);
    });

    it("should highlight common stroke width of selected elements", () => {
      const rect1 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      const rect2 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      API.setElements([rect1, rect2]);
      API.setSelectedElements([rect1, rect2]);

      const thinStrokeWidthButton = queryByTestId(
        document.body,
        `strokeWidth-thin`,
      );
      expect(thinStrokeWidthButton).toBeChecked();
    });

    it("should highlight common stroke width key across freedraw and non-freedraw elements", () => {
      const rect = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.medium,
      });
      const freedraw = API.createElement({
        type: "freedraw",
        strokeWidth: FREEDRAW_STROKE_WIDTH.medium,
      });
      API.setElements([rect, freedraw]);
      API.setSelectedElements([rect, freedraw]);

      expect(queryByTestId(document.body, `strokeWidth-medium`)).toBeChecked();
    });

    it("should apply stroke width by element type", () => {
      const rect = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      const freedraw = API.createElement({
        type: "freedraw",
        strokeWidth: FREEDRAW_STROKE_WIDTH.thin,
      });
      API.setElements([rect, freedraw]);
      API.setSelectedElements([rect, freedraw]);

      const boldStrokeWidthButton = queryByTestId(
        document.body,
        `strokeWidth-bold`,
      );
      expect(boldStrokeWidthButton).not.toBe(null);
      fireEvent.click(boldStrokeWidthButton!);

      const selectedElements = API.getSelectedElements();
      const selectedRect = selectedElements.find(
        (element) => element.type === "rectangle",
      );
      const selectedFreedraw = selectedElements.find(
        (element) => element.type === "freedraw",
      );

      expect(selectedRect?.strokeWidth).toBe(STROKE_WIDTH.bold);
      expect(selectedFreedraw?.strokeWidth).toBe(FREEDRAW_STROKE_WIDTH.bold);
    });

    it("should create new elements with stroke width by element type", () => {
      API.setAppState({ currentItemStrokeWidthKey: "bold" });

      const rect = API.createElement({ type: "rectangle" });
      const freedraw = API.createElement({ type: "freedraw" });

      expect(rect.strokeWidth).toBe(STROKE_WIDTH.bold);
      expect(freedraw.strokeWidth).toBe(FREEDRAW_STROKE_WIDTH.bold);
    });

    it("should not highlight any stroke width button if no common style", () => {
      const rect1 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.thin,
      });
      const rect2 = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.medium,
      });
      API.setElements([rect1, rect2]);
      API.setSelectedElements([rect1, rect2]);

      expect(queryByTestId(document.body, `strokeWidth-thin`)).not.toBe(null);
      expect(
        queryByTestId(document.body, `strokeWidth-thin`),
      ).not.toBeChecked();
      expect(
        queryByTestId(document.body, `strokeWidth-medium`),
      ).not.toBeChecked();
      expect(
        queryByTestId(document.body, `strokeWidth-bold`),
      ).not.toBeChecked();
    });

    it("should show properties of different element types when selected", () => {
      const rect = API.createElement({
        type: "rectangle",
        strokeWidth: STROKE_WIDTH.medium,
      });
      const text = API.createElement({
        type: "text",
        fontFamily: FONT_FAMILY["Comic Shanns"],
      });
      API.setElements([rect, text]);
      API.setSelectedElements([rect, text]);

      expect(queryByTestId(document.body, `strokeWidth-medium`)).toBeChecked();
      expect(queryByTestId(document.body, `font-family-code`)).toHaveClass(
        "active",
      );
    });
  });
});

describe("arrows bound to text whose font changes", () => {
  const { h } = window;
  const mouse = new Pointer("mouse");
  const lilitaOne = FONT_FAMILY["Lilita One"];

  const createText = (y: number, fontSize: number) => {
    const text = "First line\nSecond line\nThird line";
    const fontFamily = FONT_FAMILY.Excalifont;
    const dimensions = measureText(
      text,
      getFontString({ fontFamily, fontSize }),
      getLineHeight(fontFamily),
    );
    return API.createElement({
      type: "text",
      x: 200,
      y,
      text,
      fontSize,
      fontFamily,
      ...dimensions,
    });
  };

  const drawArrow = (
    text: ExcalidrawTextElement,
    elbowed: boolean,
    startY = 450,
    endY = text.y + text.height,
  ) => {
    const x = text.x + text.width / 2;
    UI.clickTool("arrow");
    if (elbowed) {
      UI.clickOnTestId("elbow-arrow");
    }
    mouse.downAt(x, startY);
    mouse.moveTo(x, endY);
    mouse.up();

    const arrow = h.elements.find(isArrowElement)!;
    expect(arrow.elbowed).toBe(elbowed);
    expect(arrow.endBinding?.elementId).toBe(text.id);
    return arrow;
  };

  const getEndpoint = (arrow: ExcalidrawArrowElement, index = -1) =>
    LinearElementEditor.getPointAtIndexGlobalCoordinates(
      API.getElement(arrow),
      index,
      h.app.scene.getNonDeletedElementsMap(),
    );

  const getFontAndRoute = (
    text: ExcalidrawTextElement,
    arrow: ExcalidrawArrowElement,
  ) => {
    const { fontSize, fontFamily } = API.getElement(text);
    const { x, y, points } = API.getElement(arrow);
    return { fontSize, fontFamily, x, y, points };
  };

  const getTextBounds = (text: ExcalidrawTextElement) => {
    const { x, y, width, height } = API.getElement(text);
    return { x, y, width, height };
  };

  const selectFont = (fontFamily: ExcalidrawTextElement["fontFamily"]) => {
    act(() => {
      h.app.actionManager.executeAction(actionChangeFontFamily, "api", {
        currentItemFontFamily: fontFamily,
        currentHoveredFontFamily: null,
      });
    });
  };

  const selectPendingFont = (
    fontFamily: ExcalidrawTextElement["fontFamily"],
  ) => {
    const fonts = h.app.ownerDocument.fonts;
    const loaded = resolvablePromise<FontFace[]>();
    vi.mocked(fonts.check).mockReturnValueOnce(false);
    vi.mocked(fonts.load).mockReturnValueOnce(loaded);
    selectFont(fontFamily);

    return () =>
      act(async () => {
        loaded.resolve([]);
        await loaded;
      });
  };

  const leaveFontPreview = () => {
    const popover = screen
      .getByPlaceholderText(t("quickSearch.placeholder"))
      .closest(".properties-content");
    expect(popover).not.toBeNull();
    fireEvent.pointerLeave(popover!);
    expect(h.state.currentHoveredFontFamily).toBeNull();
  };

  beforeEach(async () => {
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  describe.each([
    { kind: "simple", elbowed: false },
    { kind: "elbow", elbowed: true },
  ])("$kind arrow", ({ elbowed }) => {
    it.each(["size", "family"] as const)(
      "reroutes immediately on a font %s change and restores the text and arrow on undo and redo",
      (property) => {
        const text = createText(100, property === "size" ? FONT_SIZES.lg : 40);
        API.setElements([text]);
        const arrow = drawArrow(text, elbowed);
        API.setSelectedElements([API.getElement(text)]);
        const before = getFontAndRoute(text, arrow);
        const endBefore = getEndpoint(arrow);

        if (property === "size") {
          UI.clickOnTestId("fontSize-veryLarge");
          expect(API.getElement(text).fontSize).toBe(FONT_SIZES.xl);
        } else {
          vi.mocked(h.app.ownerDocument.fonts.check).mockReturnValueOnce(true);
          selectFont(lilitaOne);
          expect(API.getElement(text).fontFamily).toBe(lilitaOne);
        }
        const after = getFontAndRoute(text, arrow);
        const endAfter = getEndpoint(arrow);
        expect(endAfter[1]).not.toBeCloseTo(endBefore[1], 6);

        Keyboard.undo();
        expect(getFontAndRoute(text, arrow)).toEqual(before);
        Keyboard.redo();
        expect(getFontAndRoute(text, arrow)).toEqual(after);

        const textX = API.getElement(text).x;
        Keyboard.keyPress(KEYS.ARROW_RIGHT);
        expect(API.getElement(text).x).toBeGreaterThan(textX);
        Keyboard.keyPress(KEYS.ARROW_LEFT);
        expect(API.getElement(text).x).toBe(textX);

        const [nudgedX, nudgedY] = getEndpoint(arrow);
        expect(endAfter[0]).toBeCloseTo(nudgedX, 6);
        expect(endAfter[1]).toBeCloseTo(nudgedY, 6);
      },
    );

    it("leaves the arrow in place while previewing fonts and restores the text on pointer leave", () => {
      const text = createText(100, 40);
      API.setElements([text]);
      const arrow = drawArrow(text, elbowed);
      API.setSelectedElements([API.getElement(text)]);
      const before = getFontAndRoute(text, arrow);
      const endBefore = getEndpoint(arrow);
      const heightBefore = API.getElement(text).height;

      togglePopover(t("labels.showFonts"));
      const lilitaOption = screen.getByTitle("Lilita One");
      fireEvent.mouseMove(lilitaOption);
      expect(h.state.currentHoveredFontFamily).toBe(lilitaOne);
      expect(API.getElement(text).fontFamily).toBe(lilitaOne);
      expect(API.getElement(text).height).not.toBe(heightBefore);
      expect(getEndpoint(arrow)).toEqual(endBefore);

      const nunitoOption = screen.getByTitle("Nunito");
      fireEvent.mouseMove(nunitoOption);
      expect(h.state.currentHoveredFontFamily).toBe(FONT_FAMILY.Nunito);
      expect(API.getElement(text).fontFamily).toBe(FONT_FAMILY.Nunito);
      expect(getEndpoint(arrow)).toEqual(endBefore);

      leaveFontPreview();
      expect(API.getElement(text).height).toBe(heightBefore);
      expect(getFontAndRoute(text, arrow)).toEqual(before);
    });

    it("reroutes after the selected font finishes loading", async () => {
      const text = createText(100, 40);
      API.setElements([text]);
      const arrow = drawArrow(text, elbowed);
      API.setSelectedElements([API.getElement(text)]);
      const endBefore = getEndpoint(arrow);
      const heightBefore = API.getElement(text).height;
      const finishLoading = selectPendingFont(lilitaOne);
      expect(API.getElement(text).fontFamily).toBe(lilitaOne);
      expect(API.getElement(text).height).toBe(heightBefore);
      expect(getEndpoint(arrow)).toEqual(endBefore);

      await finishLoading();

      expect(API.getElement(text).height).toBeLessThan(heightBefore);
      expect(getEndpoint(arrow)[1]).toBeLessThan(endBefore[1]);
    });

    it("undoes and redoes late font layout separately from the font pick and unrelated drawing", async () => {
      const text = createText(100, 40);
      API.setElements([text]);
      const arrow = drawArrow(text, elbowed);
      API.setSelectedElements([API.getElement(text)]);

      const getFontLayout = () => ({
        ...getFontAndRoute(text, arrow),
        textBounds: getTextBounds(text),
      });
      const original = getFontLayout();
      const finishLoading = selectPendingFont(lilitaOne);
      const beforeLoad = getFontLayout();
      expect(beforeLoad).toEqual({ ...original, fontFamily: lilitaOne });

      await finishLoading();
      const afterLoad = getFontLayout();
      expect(afterLoad.fontFamily).toBe(lilitaOne);
      expect(afterLoad.textBounds.height).toBeLessThan(
        beforeLoad.textBounds.height,
      );
      expect(afterLoad.points).not.toEqual(beforeLoad.points);

      const rectangle = UI.createElement("rectangle", {
        x: 500,
        y: 100,
        size: 80,
      });
      const getRectangle = () => h.app.scene.getNonDeletedElement(rectangle.id);
      expect(getRectangle()).not.toBeNull();

      Keyboard.undo();
      expect(getRectangle()).toBeNull();
      expect(getFontLayout()).toEqual(afterLoad);

      Keyboard.undo();
      expect(getRectangle()).toBeNull();
      expect(getFontLayout()).toEqual(beforeLoad);

      Keyboard.undo();
      expect(getRectangle()).toBeNull();
      expect(getFontLayout()).toEqual(original);

      Keyboard.redo();
      expect(getRectangle()).toBeNull();
      expect(getFontLayout()).toEqual(beforeLoad);

      Keyboard.redo();
      expect(getRectangle()).toBeNull();
      expect(getFontLayout()).toEqual(afterLoad);

      Keyboard.redo();
      expect(getRectangle()).not.toBeNull();
      expect(getFontLayout()).toEqual(afterLoad);
    });

    it("keeps the arrow in place when a pending pick loads during a font preview", async () => {
      const text = createText(100, 40);
      API.setElements([text]);
      const arrow = drawArrow(text, elbowed);
      API.setSelectedElements([API.getElement(text)]);
      const original = getFontAndRoute(text, arrow);
      const endBefore = getEndpoint(arrow);
      const finishNunitoLoad = selectPendingFont(FONT_FAMILY.Nunito);
      const boundsBeforePreview = getTextBounds(text);
      expect(getFontAndRoute(text, arrow)).toEqual({
        ...original,
        fontFamily: FONT_FAMILY.Nunito,
      });

      togglePopover(t("labels.showFonts"));
      fireEvent.mouseMove(screen.getByTitle("Lilita One"));
      expect(h.state.currentHoveredFontFamily).toBe(lilitaOne);
      expect(API.getElement(text).fontFamily).toBe(lilitaOne);
      expect(getTextBounds(text).height).toBeLessThan(
        boundsBeforePreview.height,
      );
      expect(getEndpoint(arrow)).toEqual(endBefore);

      await finishNunitoLoad();
      expect(h.state.currentHoveredFontFamily).toBe(lilitaOne);
      expect(getEndpoint(arrow)).toEqual(endBefore);

      leaveFontPreview();
      expect(getTextBounds(text)).toEqual(boundsBeforePreview);
      expect(getFontAndRoute(text, arrow)).toEqual({
        ...original,
        fontFamily: FONT_FAMILY.Nunito,
      });
    });

    it("reroutes only when the latest of two pending font picks loads", async () => {
      const text = createText(100, 40);
      API.setElements([text]);
      const arrow = drawArrow(text, elbowed);
      API.setSelectedElements([API.getElement(text)]);
      const endBefore = getEndpoint(arrow);
      const finishNunitoLoad = selectPendingFont(FONT_FAMILY.Nunito);
      expect(API.getElement(text).fontFamily).toBe(FONT_FAMILY.Nunito);
      const finishLilitaLoad = selectPendingFont(lilitaOne);
      expect(API.getElement(text).fontFamily).toBe(lilitaOne);
      expect(getEndpoint(arrow)).toEqual(endBefore);

      await finishNunitoLoad();
      expect(API.getElement(text).fontFamily).toBe(lilitaOne);
      expect(getEndpoint(arrow)).toEqual(endBefore);

      await finishLilitaLoad();
      expect(API.getElement(text).fontFamily).toBe(lilitaOne);
      const endAfter = getEndpoint(arrow);
      expect(endAfter[1]).toBeLessThan(endBefore[1]);

      const textX = API.getElement(text).x;
      Keyboard.keyPress(KEYS.ARROW_RIGHT);
      expect(API.getElement(text).x).toBeGreaterThan(textX);
      Keyboard.keyPress(KEYS.ARROW_LEFT);
      expect(API.getElement(text).x).toBe(textX);
      const [nudgedX, nudgedY] = getEndpoint(arrow);
      expect(endAfter[0]).toBeCloseTo(nudgedX, 6);
      expect(endAfter[1]).toBeCloseTo(nudgedY, 6);
    });
  });

  it("reroutes a bound arrow after two font size increase shortcuts", () => {
    const text = createText(100, 40);
    API.setElements([text]);
    const arrow = drawArrow(text, false);
    API.setSelectedElements([API.getElement(text)]);
    const endBefore = getEndpoint(arrow);

    Keyboard.withModifierKeys({ ctrl: true, shift: true }, () => {
      Keyboard.keyPress(KEYS.CHEVRON_RIGHT);
      const sizeAfterFirstPress = API.getElement(text).fontSize;
      const endAfterFirstPress = getEndpoint(arrow);
      expect(sizeAfterFirstPress).toBeGreaterThan(40);
      expect(endAfterFirstPress[1]).not.toBeCloseTo(endBefore[1], 6);

      Keyboard.keyPress(KEYS.CHEVRON_RIGHT);
      expect(API.getElement(text).fontSize).toBeGreaterThan(
        sizeAfterFirstPress,
      );
      expect(getEndpoint(arrow)[1]).not.toBeCloseTo(endAfterFirstPress[1], 6);
    });
    expect(getEndpoint(arrow)[1]).toBeGreaterThan(endBefore[1]);
  });

  it("reroutes both ends of an arrow between two resized texts", () => {
    const topText = createText(100, FONT_SIZES.lg);
    const bottomText = createText(400, FONT_SIZES.lg);
    API.setElements([topText, bottomText]);
    const arrow = drawArrow(
      bottomText,
      false,
      topText.y + topText.height,
      bottomText.y,
    );
    expect(arrow.startBinding?.elementId).toBe(topText.id);
    API.setSelectedElements([
      API.getElement(topText),
      API.getElement(bottomText),
    ]);
    const startBefore = getEndpoint(arrow, 0);
    const endBefore = getEndpoint(arrow);

    UI.clickOnTestId("fontSize-veryLarge");

    expect(API.getElement(topText).fontSize).toBe(FONT_SIZES.xl);
    expect(API.getElement(bottomText).fontSize).toBe(FONT_SIZES.xl);
    expect(getEndpoint(arrow, 0)[1]).toBeGreaterThan(startBefore[1]);
    expect(getEndpoint(arrow)[1]).toBeLessThan(endBefore[1]);
  });
});
