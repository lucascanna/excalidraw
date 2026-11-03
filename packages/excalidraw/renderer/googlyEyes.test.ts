import { arrayToMap } from "@excalidraw/common";

import type { Radians } from "@excalidraw/math";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { API } from "../tests/helpers/api";

import {
  CENTERED_PUPIL,
  GOOGLY_EYES_COLORS,
  clampPupilOffset,
  drawGooglyEyes,
  getCustomDataWithGooglyEyes,
  getGooglyEyes,
  getPupilTarget,
  hasGooglyEyes,
  isGooglyEyesEligible,
  renderGooglyEyesToSvg,
} from "./googlyEyes";

import type { GooglyEye } from "./googlyEyes";

const eyesOf = (element: ExcalidrawElement) =>
  getGooglyEyes(element, arrayToMap([element]));

const rectangle = (
  props: Partial<{
    x: number;
    y: number;
    width: number;
    height: number;
    angle: number;
  }> = {},
) =>
  API.createElement({
    type: "rectangle",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    ...props,
  });

const withGooglyEyes = <T extends ExcalidrawElement>(
  element: T,
  customData: Record<string, any> = { googlyEyes: true },
): T => ({ ...element, customData });

/** an eye of radius 20 at (100, 100), the white's stroke 1.6 wide */
const EYE: GooglyEye = {
  cx: 100,
  cy: 100,
  r: 20,
  pupilRadius: 9.6,
  travel: 20 - 9.6 - 1.6,
  strokeWidth: 1.6,
};

describe("googly eyes flag", () => {
  it.each(["rectangle", "diamond", "ellipse", "freedraw", "image"] as const)(
    "%s is eligible",
    (type) => {
      expect(isGooglyEyesEligible(API.createElement({ type }))).toBe(true);
    },
  );

  it.each([
    "text",
    "arrow",
    "line",
    "frame",
    "magicframe",
    "embeddable",
    "iframe",
    "stickynote",
  ] as const)("%s is not eligible", (type) => {
    expect(isGooglyEyesEligible(API.createElement({ type }))).toBe(false);
  });

  it("a deleted shape is not eligible", () => {
    expect(isGooglyEyesEligible(rectangle({}))).toBe(true);
    expect(
      isGooglyEyesEligible(
        API.createElement({ type: "ellipse", isDeleted: true }),
      ),
    ).toBe(false);
  });

  it("reads the flag from customData.googlyEyes === true only", () => {
    expect(hasGooglyEyes(rectangle())).toBe(false);
    expect(hasGooglyEyes(withGooglyEyes(rectangle()))).toBe(true);
    expect(
      hasGooglyEyes(withGooglyEyes(rectangle(), { googlyEyes: "true" })),
    ).toBe(false);
    expect(hasGooglyEyes(withGooglyEyes(rectangle(), { googlyEyes: 1 }))).toBe(
      false,
    );
    expect(
      hasGooglyEyes(withGooglyEyes(rectangle(), { googlyEyes: false })),
    ).toBe(false);
    expect(hasGooglyEyes(withGooglyEyes(rectangle(), { other: true }))).toBe(
      false,
    );
  });

  it("an ineligible element carrying the flag has no eyes", () => {
    expect(
      hasGooglyEyes(withGooglyEyes(API.createElement({ type: "arrow" }))),
    ).toBe(false);
    expect(
      hasGooglyEyes(withGooglyEyes(API.createElement({ type: "text" }))),
    ).toBe(false);
  });

  it("setting the flag keeps the other custom data", () => {
    expect(getCustomDataWithGooglyEyes(rectangle(), true)).toEqual({
      googlyEyes: true,
    });
    expect(
      getCustomDataWithGooglyEyes(
        withGooglyEyes(rectangle(), { owner: "me", nested: { a: 1 } }),
        true,
      ),
    ).toEqual({ owner: "me", nested: { a: 1 }, googlyEyes: true });
  });

  it("clearing the flag keeps the other custom data", () => {
    expect(
      getCustomDataWithGooglyEyes(
        withGooglyEyes(rectangle(), { owner: "me", googlyEyes: true }),
        false,
      ),
    ).toEqual({ owner: "me" });
  });

  it("clearing the only custom data key leaves no custom data", () => {
    expect(
      getCustomDataWithGooglyEyes(withGooglyEyes(rectangle()), false),
    ).toBeUndefined();
    expect(getCustomDataWithGooglyEyes(rectangle(), false)).toBeUndefined();
  });

  it("does not mutate the element's custom data", () => {
    const customData = { owner: "me", googlyEyes: true };
    const element = withGooglyEyes(rectangle(), customData);
    getCustomDataWithGooglyEyes(element, false);
    getCustomDataWithGooglyEyes(element, true);
    expect(element.customData).toBe(customData);
    expect(customData).toEqual({ owner: "me", googlyEyes: true });
  });
});

describe("getGooglyEyes", () => {
  it("eye radius is 16% of the smaller side, pupil 48% of the eye", () => {
    const [left, right] = eyesOf(rectangle({ width: 200, height: 100 }));
    expect(left.r).toBeCloseTo(16);
    expect(right.r).toBeCloseTo(16);
    expect(left.pupilRadius).toBeCloseTo(16 * 0.48);

    const [tall] = eyesOf(rectangle({ width: 150, height: 300 }));
    expect(tall.r).toBeCloseTo(150 * 0.16);
    expect(tall.pupilRadius).toBeCloseTo(150 * 0.16 * 0.48);
  });

  it("eye radius never goes below 10 scene units", () => {
    const [eye] = eyesOf(rectangle({ width: 20, height: 20 }));
    expect(eye.r).toBe(10);
    expect(eye.pupilRadius).toBeCloseTo(4.8);
    // 62.5 * 0.16 = 10: the clamp's edge
    expect(eyesOf(rectangle({ width: 62.5, height: 400 }))[0].r).toBeCloseTo(
      10,
    );
    expect(eyesOf(rectangle({ width: 1, height: 1 }))[0].r).toBe(10);
  });

  it("eye radius stops growing at 36 scene units", () => {
    const [eye] = eyesOf(rectangle({ width: 2000, height: 1000 }));
    expect(eye.r).toBe(36);
    expect(eye.pupilRadius).toBeCloseTo(36 * 0.48);
    // 225 * 0.16 = 36: the clamp's edge
    expect(eyesOf(rectangle({ width: 225, height: 400 }))[0].r).toBeCloseTo(36);
  });

  it("puts two eyes side by side, symmetric around the center, at 40% of the height", () => {
    const element = rectangle({ x: 50, y: 20, width: 200, height: 100 });
    const [left, right] = eyesOf(element);
    const centerX = 50 + 200 / 2;

    expect(left.cy).toBeCloseTo(20 + 100 * 0.4);
    expect(right.cy).toBeCloseTo(20 + 100 * 0.4);
    expect(left.cx).toBeLessThan(centerX);
    expect(right.cx).toBeGreaterThan(centerX);
    expect(centerX - left.cx).toBeCloseTo(right.cx - centerX);
    // gap between the eye centers: r * 1.12 each side of the center
    expect(right.cx - centerX).toBeCloseTo(16 * 1.12);
    // the eyes do not overlap
    expect(right.cx - left.cx).toBeGreaterThan(left.r + right.r);
  });

  it.each(["ellipse", "image"] as const)(
    "%s eyes sit at 40% of the height",
    (type) => {
      const element = API.createElement({
        type,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });
      const [left, right] = eyesOf(element);
      const [x1, y1, x2, y2] = [0, 0, 100, 100];
      expect(left.cy).toBeCloseTo(y1 + (y2 - y1) * 0.4);
      expect(right.cy).toBeCloseTo(y1 + (y2 - y1) * 0.4);
      expect((left.cx + right.cx) / 2).toBeCloseTo((x1 + x2) / 2);
    },
  );

  it("diamond eyes sit at 42% of the height", () => {
    const element = API.createElement({
      type: "diamond",
      x: 10,
      y: 10,
      width: 200,
      height: 200,
    });
    const [left, right] = eyesOf(element);
    expect(left.cy).toBeCloseTo(10 + 200 * 0.42);
    expect(right.cy).toBeCloseTo(10 + 200 * 0.42);
    expect((left.cx + right.cx) / 2).toBeCloseTo(110);
  });

  it("freedraw eyes follow the stroke's bounds", () => {
    const element = API.createElement({
      type: "freedraw",
      x: 100,
      y: 100,
      points: [
        [0, 0],
        [50, 80],
        [200, 40],
      ] as any,
    });
    const [left, right] = eyesOf(element);
    expect(left.r).toBeCloseTo(80 * 0.16);
    expect((left.cx + right.cx) / 2).toBeCloseTo(100 + 200 / 2);
    expect(left.cy).toBeCloseTo(100 + 80 * 0.4);
  });

  it("the eyes move with the element", () => {
    const [left, right] = eyesOf(rectangle({ x: 0, y: 0 }));
    const [movedLeft, movedRight] = eyesOf(rectangle({ x: 300, y: -40 }));
    expect(movedLeft.cx - left.cx).toBeCloseTo(300);
    expect(movedLeft.cy - left.cy).toBeCloseTo(-40);
    expect(movedRight.cx - right.cx).toBeCloseTo(300);
    expect(movedRight.cy - right.cy).toBeCloseTo(-40);
  });

  it("the eyes rotate with the element, around its center", () => {
    const angle = Math.PI / 2;
    const [left, right] = eyesOf(
      rectangle({ x: 0, y: 0, width: 200, height: 100, angle }),
    );
    // unrotated: (100 ∓ 17.92, 40), rotated a quarter turn around (100, 50)
    const rotate = (x: number, y: number) => {
      const [cx, cy] = [100, 50];
      return [
        (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle) + cx,
        (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle) + cy,
      ];
    };
    const gap = 16 * 1.12;
    const [expectedLeftX, expectedLeftY] = rotate(100 - gap, 40);
    const [expectedRightX, expectedRightY] = rotate(100 + gap, 40);

    expect(left.cx).toBeCloseTo(expectedLeftX);
    expect(left.cy).toBeCloseTo(expectedLeftY);
    expect(right.cx).toBeCloseTo(expectedRightX);
    expect(right.cy).toBeCloseTo(expectedRightY);
    // the "top" is now on the right side: the eyes stack vertically
    expect(left.cx).toBeCloseTo(right.cx);
    expect(left.cx).toBeGreaterThan(100);
    // the size does not change with the rotation
    expect(left.r).toBeCloseTo(16);
  });

  it("the eyes keep their distance to the element center whatever the angle", () => {
    const element = rectangle({ x: 0, y: 0, width: 200, height: 100 });
    const [left] = eyesOf(element);
    const distance = Math.hypot(left.cx - 100, left.cy - 50);
    for (const angle of [0.3, 1, 2.5, 4]) {
      const [rotatedLeft, rotatedRight] = eyesOf({
        ...element,
        angle: angle as Radians,
      });
      expect(Math.hypot(rotatedLeft.cx - 100, rotatedLeft.cy - 50)).toBeCloseTo(
        distance,
      );
      expect(
        Math.hypot(rotatedRight.cx - 100, rotatedRight.cy - 50),
      ).toBeCloseTo(distance);
    }
  });

  it("applies the render offset", () => {
    const element = rectangle();
    const [left, right] = eyesOf(element);
    const [offsetLeft, offsetRight] = getGooglyEyes(
      element,
      arrayToMap([element]),
      { x: 7, y: -3 },
    );
    expect(offsetLeft.cx).toBeCloseTo(left.cx + 7);
    expect(offsetLeft.cy).toBeCloseTo(left.cy - 3);
    expect(offsetRight.cx).toBeCloseTo(right.cx + 7);
    expect(offsetRight.cy).toBeCloseTo(right.cy - 3);
  });

  it.each([
    [20, 20],
    [200, 100],
    [2000, 1000],
  ])("a %sx%s shape's pupil travel keeps it inside the white", (w, h) => {
    for (const eye of eyesOf(rectangle({ width: w, height: h }))) {
      expect(eye.travel).toBeGreaterThan(0);
      expect(eye.travel + eye.pupilRadius).toBeLessThanOrEqual(
        eye.r - eye.strokeWidth / 2,
      );
    }
  });
});

describe("getPupilTarget", () => {
  it("looks down before the pointer has moved", () => {
    const target = getPupilTarget(EYE, null);
    expect(target.x).toBe(0);
    expect(target.y).toBeGreaterThan(0);
    expect(target.y).toBeCloseTo(EYE.travel * 0.6);
  });

  it.each([
    ["right", { x: 400, y: 100 }],
    ["left", { x: -200, y: 100 }],
    ["up", { x: 100, y: -300 }],
    ["down", { x: 100, y: 500 }],
    ["up-left", { x: 40, y: 30 }],
    ["down-right", { x: 130, y: 145 }],
  ])("points toward the pointer (%s)", (_, pointer) => {
    const target = getPupilTarget(EYE, pointer);
    const dx = pointer.x - EYE.cx;
    const dy = pointer.y - EYE.cy;
    const length = Math.hypot(target.x, target.y);
    expect(length).toBeGreaterThan(0);
    // same direction: parallel, and not opposite
    expect(
      (target.x * dx + target.y * dy) / (length * Math.hypot(dx, dy)),
    ).toBeCloseTo(1);
  });

  it("centers the pupil when the pointer is on the eye center", () => {
    const target = getPupilTarget(EYE, { x: EYE.cx, y: EYE.cy });
    expect(Math.hypot(target.x, target.y)).toBe(0);
  });

  it("travels further as the pointer moves away, up to full travel a few eye widths away", () => {
    const travels = [1, 5, 10, 20, 40, 60, 80, 120, 1000, 1e6].map(
      (distance) => {
        const target = getPupilTarget(EYE, { x: EYE.cx + distance, y: EYE.cy });
        expect(Number.isFinite(target.x)).toBe(true);
        return Math.hypot(target.x, target.y);
      },
    );
    for (let i = 1; i < travels.length; i++) {
      expect(travels[i]).toBeGreaterThanOrEqual(travels[i - 1] - 1e-9);
    }
    // near the eye, only part of the travel
    expect(travels[0]).toBeLessThan(EYE.travel);
    expect(
      Math.hypot(
        ...Object.values(getPupilTarget(EYE, { x: EYE.cx + EYE.r, y: EYE.cy })),
      ),
    ).toBeLessThan(EYE.travel);
    // a few (4) eye widths away: full travel
    const farAway = getPupilTarget(EYE, {
      x: EYE.cx + EYE.r * 2 * 4,
      y: EYE.cy,
    });
    expect(Math.hypot(farAway.x, farAway.y)).toBeCloseTo(EYE.travel);
  });

  it("never exceeds the travel", () => {
    for (const pointer of [
      { x: 1e9, y: -1e9 },
      { x: -5000, y: 3 },
      { x: 101, y: 101 },
      { x: 100 + EYE.r, y: 100 + EYE.r },
    ]) {
      const target = getPupilTarget(EYE, pointer);
      expect(Math.hypot(target.x, target.y)).toBeLessThanOrEqual(
        EYE.travel + 1e-9,
      );
    }
  });
});

describe("clampPupilOffset", () => {
  it("keeps an offset that is already inside", () => {
    expect(clampPupilOffset(EYE, { x: 2, y: -3 })).toEqual({ x: 2, y: -3 });
  });

  it("pulls an offset outside the white back to the travel, same direction", () => {
    const clamped = clampPupilOffset(EYE, { x: 30, y: 40 });
    expect(Math.hypot(clamped.x, clamped.y)).toBeCloseTo(EYE.travel);
    expect(clamped.x / clamped.y).toBeCloseTo(30 / 40);
    expect(clamped.x).toBeGreaterThan(0);

    const opposite = clampPupilOffset(EYE, { x: -1000, y: 0 });
    expect(opposite.x).toBeCloseTo(-EYE.travel);
    expect(opposite.y).toBeCloseTo(0);
  });

  it("keeps the pupil inside the white whatever the offset", () => {
    for (const offset of [
      { x: 1e9, y: 1e9 },
      { x: -EYE.r, y: EYE.r },
      { x: EYE.travel, y: 0 },
      { x: 0, y: -EYE.travel - 0.001 },
    ]) {
      const clamped = clampPupilOffset(EYE, offset);
      expect(Math.hypot(clamped.x, clamped.y) + EYE.pupilRadius).toBeLessThan(
        EYE.r,
      );
    }
  });

  it("centers a zero or NaN offset", () => {
    expect(clampPupilOffset(EYE, { x: 0, y: 0 })).toEqual(CENTERED_PUPIL);
    expect(clampPupilOffset(EYE, { x: NaN, y: 3 })).toEqual(CENTERED_PUPIL);
  });

  it("keeps an infinite offset inside the white", () => {
    const clamped = clampPupilOffset(EYE, { x: Infinity, y: 0 });
    expect(Number.isFinite(clamped.x)).toBe(true);
    expect(Number.isFinite(clamped.y)).toBe(true);
    expect(Math.hypot(clamped.x, clamped.y)).toBeLessThanOrEqual(EYE.travel);
  });
});

type ArcEvent = {
  type: "arc";
  props: { x: number; y: number; radius: number };
};

const getArcs = (context: CanvasRenderingContext2D) =>
  ((context as any).__getEvents() as { type: string }[])
    .filter((event): event is ArcEvent => event.type === "arc")
    .map(({ props: { x, y, radius } }) => ({ x, y, radius }));

describe("drawGooglyEyes", () => {
  /** records the color and alpha of each fill and stroke */
  const setup = () => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    const fills: string[] = [];
    const strokes: string[] = [];
    const alphas: number[] = [];
    // the canvas mock's methods are mocks already: wrap their implementation
    const record = (
      method: "fill" | "stroke",
      onPaint: (context: CanvasRenderingContext2D) => void,
    ) => {
      const mock = context[method] as any;
      const implementation = mock.getMockImplementation();
      mock.mockImplementation(function (this: any, ...args: any[]) {
        onPaint(context);
        alphas.push(context.globalAlpha);
        return implementation?.apply(this, args);
      });
    };
    record("fill", () => fills.push(String(context.fillStyle).toLowerCase()));
    record("stroke", () =>
      strokes.push(String(context.strokeStyle).toLowerCase()),
    );
    return { context, fills, strokes, alphas };
  };

  it("draws a white, a pupil and a glint per eye", () => {
    const { context, fills, strokes } = setup();
    const eyes = eyesOf(rectangle());
    drawGooglyEyes(context, eyes, null, 1);

    const arcs = getArcs(context);
    expect(arcs).toHaveLength(6);
    eyes.forEach((eye, index) => {
      const [white, pupil, glint] = arcs.slice(index * 3, index * 3 + 3);
      expect(white).toEqual({ x: eye.cx, y: eye.cy, radius: eye.r });
      // no pupils given: centered
      expect(pupil).toEqual({ x: eye.cx, y: eye.cy, radius: eye.pupilRadius });
      expect(glint.x).toBeCloseTo(eye.cx - eye.pupilRadius * 0.35);
      expect(glint.y).toBeCloseTo(eye.cy - eye.pupilRadius * 0.35);
      expect(glint.radius).toBeCloseTo(eye.pupilRadius * 0.22);
    });
    expect(fills).toEqual([
      GOOGLY_EYES_COLORS.white,
      GOOGLY_EYES_COLORS.ink,
      GOOGLY_EYES_COLORS.white,
      GOOGLY_EYES_COLORS.white,
      GOOGLY_EYES_COLORS.ink,
      GOOGLY_EYES_COLORS.white,
    ]);
    expect(strokes).toEqual([GOOGLY_EYES_COLORS.ink, GOOGLY_EYES_COLORS.ink]);
    expect(GOOGLY_EYES_COLORS).toEqual({ white: "#ffffff", ink: "#1e1e1e" });
  });

  it("moves the pupils by the given offsets, clamped inside the white", () => {
    const { context } = setup();
    const eyes = eyesOf(rectangle());
    drawGooglyEyes(
      context,
      eyes,
      [
        { x: 2, y: 1 },
        { x: 500, y: 0 },
      ],
      1,
    );

    const [, leftPupil, , , rightPupil] = getArcs(context);
    expect(leftPupil.x).toBeCloseTo(eyes[0].cx + 2);
    expect(leftPupil.y).toBeCloseTo(eyes[0].cy + 1);
    expect(rightPupil.x).toBeCloseTo(eyes[1].cx + eyes[1].travel);
    expect(rightPupil.y).toBeCloseTo(eyes[1].cy);
    expect(rightPupil.x - eyes[1].cx + eyes[1].pupilRadius).toBeLessThan(
      eyes[1].r,
    );
  });

  it("draws with the element opacity and restores the context", () => {
    const { context, alphas } = setup();
    context.globalAlpha = 0.5;
    drawGooglyEyes(context, eyesOf(rectangle()), null, 0.4);
    expect(alphas.length).toBeGreaterThan(0);
    alphas.forEach((alpha) => expect(alpha).toBeCloseTo(0.2));
    expect(context.globalAlpha).toBe(0.5);
  });

  it("draws nothing for no eyes", () => {
    const { context, fills, strokes } = setup();
    drawGooglyEyes(context, [], null, 1);
    expect(getArcs(context)).toEqual([]);
    expect(fills).toEqual([]);
    expect(strokes).toEqual([]);
  });
});

describe("renderGooglyEyesToSvg", () => {
  it("renders the eyes as a group of six circles with centered pupils", () => {
    const eyes = eyesOf(rectangle({ x: 0, y: 0, width: 200, height: 100 }));
    const group = renderGooglyEyesToSvg(document, eyes, 10, 20, 1);

    expect(group.tagName).toBe("g");
    expect(group.getAttribute("class")).toBe("googly-eyes");
    expect(group.hasAttribute("opacity")).toBe(false);
    const circles = Array.from(group.querySelectorAll("circle"));
    expect(circles).toHaveLength(6);

    const num = (node: Element, name: string) =>
      Number(node.getAttribute(name));
    eyes.forEach((eye, index) => {
      const [white, pupil, glint] = circles.slice(index * 3, index * 3 + 3);
      expect(num(white, "cx")).toBeCloseTo(eye.cx + 10, 1);
      expect(num(white, "cy")).toBeCloseTo(eye.cy + 20, 1);
      expect(num(white, "r")).toBeCloseTo(eye.r, 1);
      expect(white.getAttribute("fill")).toBe("#ffffff");
      expect(white.getAttribute("stroke")).toBe("#1e1e1e");

      expect(num(pupil, "cx")).toBe(num(white, "cx"));
      expect(num(pupil, "cy")).toBe(num(white, "cy"));
      expect(num(pupil, "r")).toBeCloseTo(eye.pupilRadius, 1);
      expect(pupil.getAttribute("fill")).toBe("#1e1e1e");

      expect(glint.getAttribute("fill")).toBe("#ffffff");
      expect(num(glint, "r")).toBeLessThan(num(pupil, "r"));
    });
  });

  it("sets the opacity of a translucent element", () => {
    const group = renderGooglyEyesToSvg(
      document,
      eyesOf(rectangle()),
      0,
      0,
      0.3,
    );
    expect(group.getAttribute("opacity")).toBe("0.3");
  });
});
