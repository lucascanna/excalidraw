import { viewportCoordsToSceneCoords } from "@excalidraw/common";

import {
  getBoundTextElement,
  getElementBounds,
  isIframeLikeElement,
  isTextElement,
  renderElement,
  resolveElementRenderState,
} from "@excalidraw/element";

import type { ElementRenderState } from "@excalidraw/element";

import type { Bounds } from "@excalidraw/common";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import {
  drawGooglyEyes,
  getGooglyEyes,
  getPupilTarget,
  hasGooglyEyes,
} from "./googlyEyes";
import {
  bootstrapCanvas,
  getNormalizedCanvasDimensions,
  snapScrollToDevicePixels,
} from "./helpers";
import { clipElementToItsFrame } from "./staticScene";

import type { GooglyEye, PupilOffset } from "./googlyEyes";

import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "../scene/types";
import type { StaticCanvasAppState } from "../types";
import type { RoughCanvas } from "roughjs/bin/canvas";

export type GooglyEyesSceneConfig = {
  canvas: HTMLCanvasElement;
  rc: RoughCanvas;
  scale: number;
  appState: StaticCanvasAppState;
  elementsMap: RenderableElementsMap;
  allElementsMap: NonDeletedSceneElementsMap;
  visibleElements: readonly NonDeletedExcalidrawElement[];
  renderConfig: StaticCanvasRenderConfig;
};

type Spring = { x: number; y: number; vx: number; vy: number };

// A short springy ease: slightly underdamped, settles in about 0.2 s.
const SPRING_STIFFNESS = 36 * 36;
const SPRING_DAMPING = 2 * 0.5 * 36;
const SPRING_STEP = 1 / 240;
const MAX_FRAME_TIME = 1 / 20;
const IDLE_FRAME_TIME = 1 / 60;
const SETTLE_DISTANCE = 0.01;
const SETTLE_SPEED = 0.05;

const stepSpring = (spring: Spring, target: PupilOffset, dt: number) => {
  let remaining = dt;
  while (remaining > 0) {
    const step = Math.min(SPRING_STEP, remaining);
    remaining -= step;
    spring.vx +=
      (SPRING_STIFFNESS * (target.x - spring.x) - SPRING_DAMPING * spring.vx) *
      step;
    spring.vy +=
      (SPRING_STIFFNESS * (target.y - spring.y) - SPRING_DAMPING * spring.vy) *
      step;
    spring.x += spring.vx * step;
    spring.y += spring.vy * step;
  }
  const settled =
    Math.abs(target.x - spring.x) < SETTLE_DISTANCE &&
    Math.abs(target.y - spring.y) < SETTLE_DISTANCE &&
    Math.abs(spring.vx) < SETTLE_SPEED &&
    Math.abs(spring.vy) < SETTLE_SPEED;
  if (settled) {
    spring.x = target.x;
    spring.y = target.y;
    spring.vx = 0;
    spring.vy = 0;
  }
  return settled;
};

const boundsOverlap = (a: Bounds, b: Bounds) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

const getEyesBounds = (eyes: readonly GooglyEye[]): Bounds => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const eye of eyes) {
    const reach = eye.r + eye.strokeWidth;
    minX = Math.min(minX, eye.cx - reach);
    minY = Math.min(minY, eye.cy - reach);
    maxX = Math.max(maxX, eye.cx + reach);
    maxY = Math.max(maxY, eye.cy + reach);
  }
  return [minX, minY, maxX, maxY];
};

/**
 * Draws the googly eyes of the visible elements on their own canvas, between
 * the static scene and the interactive layer, and animates the pupils toward
 * this user's pointer. A pointer move repaints only this canvas.
 *
 * An element drawn above an eyed element erases the eyes it covers
 * (`destination-out` with its own pixels), so the eyes keep the scene's
 * z-order even though they sit on a layer above it.
 */
export class GooglyEyesAnimator {
  private config: GooglyEyesSceneConfig | null = null;
  /** the last pointer position, in viewport coordinates; never synced */
  private pointer: { clientX: number; clientY: number } | null = null;
  private springs = new Map<string, Spring>();
  private frameId: number | null = null;
  private lastFrameTime: number | null = null;
  private hasEyes = false;
  private isCanvasDirty = false;

  /** Tracks this user's pointer (mouse or the last touch point). */
  setPointer(clientX: number, clientY: number) {
    if (
      this.pointer?.clientX === clientX &&
      this.pointer?.clientY === clientY
    ) {
      return;
    }
    this.pointer = { clientX, clientY };
    if (this.hasEyes) {
      this.scheduleFrame();
    }
  }

  /** Called on every overlay render: the scene or viewport changed. */
  update(config: GooglyEyesSceneConfig, throttle: boolean) {
    this.config = config;
    if (throttle) {
      this.scheduleFrame();
    } else {
      this.paint();
    }
  }

  destroy() {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.config = null;
    this.springs.clear();
    this.hasEyes = false;
  }

  private scheduleFrame() {
    if (this.frameId !== null || !this.config) {
      return;
    }
    this.frameId = requestAnimationFrame(this.onFrame);
  }

  private onFrame = () => {
    this.frameId = null;
    this.paint();
  };

  private getScenePointer(appState: StaticCanvasAppState) {
    return this.pointer
      ? viewportCoordsToSceneCoords(this.pointer, appState)
      : null;
  }

  private paint() {
    const config = this.config;
    if (!config) {
      return;
    }
    const now = performance.now();
    // the first frame after a rest moves the pupils a frame's worth already
    const dt =
      this.lastFrameTime === null
        ? IDLE_FRAME_TIME
        : Math.min(MAX_FRAME_TIME, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    const {
      canvas,
      rc,
      scale,
      elementsMap,
      allElementsMap,
      visibleElements,
      renderConfig,
    } = config;

    const hasEyes = visibleElements.some(hasGooglyEyes);
    this.hasEyes = hasEyes;
    if (!hasEyes) {
      if (this.isCanvasDirty) {
        const [width, height] = getNormalizedCanvasDimensions(canvas, scale);
        bootstrapCanvas({
          canvas,
          scale,
          normalizedWidth: width,
          normalizedHeight: height,
        });
        this.isCanvasDirty = false;
      }
      this.springs.clear();
      this.lastFrameTime = null;
      return;
    }

    // the same whole-pixel scroll the static scene draws with
    const appState = snapScrollToDevicePixels(config.appState, scale);
    const pointer = this.getScenePointer(config.appState);
    const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
      canvas,
      scale,
    );
    const context = bootstrapCanvas({
      canvas,
      scale,
      normalizedWidth,
      normalizedHeight,
    });
    context.scale(appState.zoom.value, appState.zoom.value);
    this.isCanvasDirty = true;

    const getRenderState = (element: ExcalidrawElement) =>
      resolveElementRenderState(
        element,
        elementsMap,
        renderConfig,
        allElementsMap,
      );

    const inFrameGroupsMap = new Map<string, boolean>();
    // the same frame clip as the static scene, dragging into a frame included
    const clipToFrame = (
      element: NonDeletedExcalidrawElement,
      renderState: ElementRenderState,
    ) =>
      clipElementToItsFrame(element, renderState, {
        context,
        renderConfig,
        appState,
        elementsMap,
        getRenderState,
        inFrameGroupsMap,
      });

    const eyesBounds: Bounds[] = [];
    const coversEyes = (
      element: NonDeletedExcalidrawElement,
      renderState: ElementRenderState,
    ) => {
      if (!eyesBounds.length) {
        return false;
      }
      const [x1, y1, x2, y2] = getElementBounds(element, elementsMap);
      const pad = element.strokeWidth;
      const bounds: Bounds = [
        x1 + renderState.offset.x - pad,
        y1 + renderState.offset.y - pad,
        x2 + renderState.offset.x + pad,
        y2 + renderState.offset.y + pad,
      ];
      return eyesBounds.some((eyes) => boundsOverlap(eyes, bounds));
    };

    const erase = (
      element: NonDeletedExcalidrawElement,
      renderState: ElementRenderState,
    ) => {
      context.save();
      context.globalCompositeOperation = "destination-out";
      clipToFrame(element, renderState);
      renderElement(
        element,
        elementsMap,
        allElementsMap,
        rc,
        context,
        renderConfig,
        appState,
        renderState,
      );
      context.restore();
    };

    let isSettled = true;
    const seenSprings = new Set<string>();

    const paintEyes = (
      element: NonDeletedExcalidrawElement,
      renderState: ElementRenderState,
    ) => {
      const eyes = getGooglyEyes(element, elementsMap, renderState.offset);
      const pupils = eyes.map((eye, index) => {
        const key = `${element.id}:${index}`;
        seenSprings.add(key);
        const target = getPupilTarget(eye, pointer);
        let spring = this.springs.get(key);
        if (!spring) {
          // new eyes open already looking at the pointer
          spring = { x: target.x, y: target.y, vx: 0, vy: 0 };
          this.springs.set(key, spring);
        } else if (!stepSpring(spring, target, dt)) {
          isSettled = false;
        }
        return { x: spring.x, y: spring.y };
      });

      context.save();
      clipToFrame(element, renderState);
      context.translate(appState.scrollX, appState.scrollY);
      drawGooglyEyes(context, eyes, pupils, renderState.opacity);
      context.restore();
      eyesBounds.push(getEyesBounds(eyes));
    };

    const paintElement = (element: NonDeletedExcalidrawElement) => {
      if (!eyesBounds.length && !hasGooglyEyes(element)) {
        // nothing painted yet that this element could cover
        return;
      }
      if (
        isTextElement(element) &&
        element.containerId &&
        elementsMap.has(element.containerId)
      ) {
        // painted with its container
        return;
      }
      const renderState = getRenderState(element);
      if (coversEyes(element, renderState)) {
        erase(element, renderState);
      }
      if (hasGooglyEyes(element) && renderState.opacity > 0) {
        paintEyes(element, renderState);
      }
      // the label sits above the eyes
      const boundText = getBoundTextElement(element, elementsMap);
      if (boundText) {
        const boundTextState = getRenderState(boundText);
        if (coversEyes(boundText, boundTextState)) {
          erase(boundText, boundTextState);
        }
      }
    };

    try {
      // same order as the static scene: embeddables are drawn last
      for (const element of visibleElements) {
        if (!isIframeLikeElement(element)) {
          paintElement(element);
        }
      }
      for (const element of visibleElements) {
        if (isIframeLikeElement(element)) {
          paintElement(element);
        }
      }
    } catch (error: any) {
      console.error(error);
    }

    for (const key of this.springs.keys()) {
      if (!seenSprings.has(key)) {
        this.springs.delete(key);
      }
    }

    if (isSettled) {
      this.lastFrameTime = null;
    } else {
      this.scheduleFrame();
    }
  }
}
