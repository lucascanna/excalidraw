import { clamp, pointFrom, pointRotateRads } from "@excalidraw/math";

import { getElementAbsoluteCoords } from "@excalidraw/element";

import type { GlobalPoint } from "@excalidraw/math";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

/**
 * Googly eyes are a decoration flagged on the element, in
 * `customData.googlyEyes`. They are drawn on top of the element (below its
 * label): on a light overlay canvas in the editor, where the pupils follow
 * the local pointer, and inline with the element in PNG and SVG exports,
 * where the pupils are centered.
 */
export const GOOGLY_EYES_KEY = "googlyEyes";

const GOOGLY_EYES_ELEMENT_TYPES: ReadonlySet<ExcalidrawElement["type"]> =
  new Set(["rectangle", "diamond", "ellipse", "freedraw", "image"]);

/** The colors stay the same in the dark theme: the eyes are never inverted. */
export const GOOGLY_EYES_COLORS = {
  white: "#ffffff",
  ink: "#1e1e1e",
} as const;

export const isGooglyEyesEligible = (element: ExcalidrawElement) =>
  !element.isDeleted && GOOGLY_EYES_ELEMENT_TYPES.has(element.type);

export const hasGooglyEyes = (element: ExcalidrawElement) =>
  isGooglyEyesEligible(element) &&
  element.customData?.[GOOGLY_EYES_KEY] === true;

/** Returns the element's `customData` with the googly eyes flag set or cleared. */
export const getCustomDataWithGooglyEyes = (
  element: ExcalidrawElement,
  googlyEyes: boolean,
): ExcalidrawElement["customData"] => {
  const { [GOOGLY_EYES_KEY]: _, ...rest } = element.customData ?? {};
  if (googlyEyes) {
    return { ...rest, [GOOGLY_EYES_KEY]: true };
  }
  return Object.keys(rest).length ? rest : undefined;
};

export type GooglyEye = {
  /** center, in scene coordinates */
  cx: number;
  cy: number;
  r: number;
  pupilRadius: number;
  /** how far the pupil center may move from the eye center */
  travel: number;
  strokeWidth: number;
};

export type PupilOffset = { x: number; y: number };

export const CENTERED_PUPIL: PupilOffset = { x: 0, y: 0 };

const EYE_RADIUS_RATIO = 0.16;
const MIN_EYE_RADIUS = 10;
const MAX_EYE_RADIUS = 36;
const PUPIL_RATIO = 0.48;
const EYE_GAP_RATIO = 1.12;
/** the pupil reaches full travel this many eye radii away (three eye widths) */
const FULL_TRAVEL_DISTANCE_IN_RADII = 6;
/** before the pointer has moved, the eyes look down */
const RESTING_LOOK_DOWN = 0.6;

/**
 * Two eyes side by side on the upper middle of the element bounds, rotated
 * with the element.
 */
export const getGooglyEyes = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
  offset: { x: number; y: number } = CENTERED_PUPIL,
): [GooglyEye, GooglyEye] => {
  const [x1, y1, x2, y2, centerX, centerY] = getElementAbsoluteCoords(
    element,
    elementsMap,
  );
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const r = clamp(
    Math.min(width, height) * EYE_RADIUS_RATIO,
    MIN_EYE_RADIUS,
    MAX_EYE_RADIUS,
  );
  const pupilRadius = r * PUPIL_RATIO;
  const strokeWidth = clamp(r * 0.08, 1, 2.5);
  // keep the pupil inside the white, clear of the outline
  const travel = Math.max(0, r - pupilRadius - strokeWidth);
  const eyeY =
    Math.min(y1, y2) + height * (element.type === "diamond" ? 0.42 : 0.4);
  const gap = r * EYE_GAP_RATIO;
  const center = pointFrom<GlobalPoint>(centerX, centerY);

  const eye = (direction: -1 | 1): GooglyEye => {
    const [cx, cy] = pointRotateRads(
      pointFrom<GlobalPoint>(centerX + direction * gap, eyeY),
      center,
      element.angle,
    );
    return {
      cx: cx + offset.x,
      cy: cy + offset.y,
      r,
      pupilRadius,
      travel,
      strokeWidth,
    };
  };

  return [eye(-1), eye(1)];
};

/**
 * Where the pupil should rest when the pointer (scene coordinates) is at
 * `pointer`. The travel grows with the distance, up to full travel a few
 * eye widths away. With no pointer yet, the eyes look down.
 */
export const getPupilTarget = (
  eye: GooglyEye,
  pointer: { x: number; y: number } | null,
): PupilOffset => {
  if (!pointer) {
    return { x: 0, y: eye.travel * RESTING_LOOK_DOWN };
  }
  const dx = pointer.x - eye.cx;
  const dy = pointer.y - eye.cy;
  const distance = Math.hypot(dx, dy);
  if (!(distance > 1e-6)) {
    return { x: 0, y: 0 };
  }
  const travel =
    eye.travel *
    Math.min(1, distance / (eye.r * FULL_TRAVEL_DISTANCE_IN_RADII));
  return { x: (dx / distance) * travel, y: (dy / distance) * travel };
};

/** Keeps the pupil inside the white, whatever the spring does. */
export const clampPupilOffset = (
  eye: GooglyEye,
  offset: PupilOffset,
): PupilOffset => {
  const distance = Math.hypot(offset.x, offset.y);
  if (distance === Infinity) {
    // point along the infinite axes, at full travel
    const axis = (value: number) =>
      value === Infinity ? 1 : value === -Infinity ? -1 : 0;
    let x = axis(offset.x);
    let y = axis(offset.y);
    if (!x && !y) {
      // two huge finite values whose length overflows
      x = Math.sign(offset.x);
      y = Math.sign(offset.y);
    }
    const ratio = eye.travel / Math.hypot(x, y);
    return { x: x * ratio, y: y * ratio };
  }
  // NaN or zero
  if (!(distance > 0)) {
    return CENTERED_PUPIL;
  }
  if (distance <= eye.travel) {
    return offset;
  }
  const ratio = eye.travel / distance;
  return { x: offset.x * ratio, y: offset.y * ratio };
};

const getGlint = (
  eye: GooglyEye,
  pupil: PupilOffset,
): { cx: number; cy: number; r: number } => ({
  cx: eye.cx + pupil.x - eye.pupilRadius * 0.35,
  cy: eye.cy + pupil.y - eye.pupilRadius * 0.35,
  r: eye.pupilRadius * 0.22,
});

/**
 * Draws the eyes on a canvas whose transform maps scene coordinates (the
 * caller translates by the scroll).
 */
export const drawGooglyEyes = (
  context: CanvasRenderingContext2D,
  eyes: readonly GooglyEye[],
  pupils: readonly PupilOffset[] | null,
  opacity: number,
) => {
  context.save();
  context.globalAlpha *= opacity;
  eyes.forEach((eye, index) => {
    const pupil = clampPupilOffset(eye, pupils?.[index] ?? CENTERED_PUPIL);

    context.beginPath();
    context.arc(eye.cx, eye.cy, eye.r, 0, Math.PI * 2);
    context.fillStyle = GOOGLY_EYES_COLORS.white;
    context.fill();
    context.lineWidth = eye.strokeWidth;
    context.strokeStyle = GOOGLY_EYES_COLORS.ink;
    context.stroke();

    context.beginPath();
    context.arc(
      eye.cx + pupil.x,
      eye.cy + pupil.y,
      eye.pupilRadius,
      0,
      Math.PI * 2,
    );
    context.fillStyle = GOOGLY_EYES_COLORS.ink;
    context.fill();

    const glint = getGlint(eye, pupil);
    context.beginPath();
    context.arc(glint.cx, glint.cy, glint.r, 0, Math.PI * 2);
    context.fillStyle = GOOGLY_EYES_COLORS.white;
    context.fill();
  });
  context.restore();
};

const SVG_NS = "http://www.w3.org/2000/svg";

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The eyes as an SVG group, pupils centered (exports). `translateX/Y` map
 * scene coordinates to the SVG's.
 */
export const renderGooglyEyesToSvg = (
  ownerDocument: Document,
  eyes: readonly GooglyEye[],
  translateX: number,
  translateY: number,
  opacity: number,
): SVGGElement => {
  const group = ownerDocument.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "googly-eyes");
  if (opacity < 1) {
    group.setAttribute("opacity", `${opacity}`);
  }
  const circle = (
    cx: number,
    cy: number,
    r: number,
    attributes: Record<string, string>,
  ) => {
    const node = ownerDocument.createElementNS(SVG_NS, "circle");
    node.setAttribute("cx", `${round(cx + translateX)}`);
    node.setAttribute("cy", `${round(cy + translateY)}`);
    node.setAttribute("r", `${round(r)}`);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, value);
    }
    group.appendChild(node);
  };
  for (const eye of eyes) {
    circle(eye.cx, eye.cy, eye.r, {
      fill: GOOGLY_EYES_COLORS.white,
      stroke: GOOGLY_EYES_COLORS.ink,
      "stroke-width": `${round(eye.strokeWidth)}`,
    });
    circle(eye.cx, eye.cy, eye.pupilRadius, {
      fill: GOOGLY_EYES_COLORS.ink,
    });
    const glint = getGlint(eye, CENTERED_PUPIL);
    circle(glint.cx, glint.cy, glint.r, { fill: GOOGLY_EYES_COLORS.white });
  }
  return group;
};
