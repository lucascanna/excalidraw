/**
 * Emoji are drawn with the system's color emoji font: no emoji image set is
 * bundled.
 */
export const EMOJI_FONT_FAMILY = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif`;

/** the font size the glyph is measured at before it is fitted */
const MEASURE_FONT_SIZE = 100;

/**
 * Draws `emoji` centered on a transparent `size` x `size` canvas, its ink
 * scaled to fill the canvas less `padding` (a fraction of `size`) per side.
 */
export const renderEmojiToCanvas = (
  emoji: string,
  size: number,
  padding = 0,
): HTMLCanvasElement | null => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const box = size * (1 - 2 * padding);

  context.font = `${MEASURE_FONT_SIZE}px ${EMOJI_FONT_FAMILY}`;
  const metrics = context.measureText(emoji);
  const inkLeft = metrics.actualBoundingBoxLeft;
  const inkRight = metrics.actualBoundingBoxRight;
  const inkAscent = metrics.actualBoundingBoxAscent;
  const inkDescent = metrics.actualBoundingBoxDescent;
  const inkWidth = inkLeft + inkRight;
  const inkHeight = inkAscent + inkDescent;

  if (
    !Number.isFinite(inkWidth) ||
    !Number.isFinite(inkHeight) ||
    inkWidth <= 0 ||
    inkHeight <= 0
  ) {
    // no ink metrics: center the em box instead
    context.font = `${box}px ${EMOJI_FONT_FAMILY}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(emoji, size / 2, size / 2);
    return canvas;
  }

  // draw at the final font size (sharper than scaling the context)
  const scale = Math.min(box / inkWidth, box / inkHeight);
  context.font = `${MEASURE_FONT_SIZE * scale}px ${EMOJI_FONT_FAMILY}`;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillText(
    emoji,
    size / 2 - ((inkRight - inkLeft) / 2) * scale,
    size / 2 + ((inkAscent - inkDescent) / 2) * scale,
  );
  return canvas;
};
