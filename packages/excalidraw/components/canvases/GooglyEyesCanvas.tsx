import React, { useEffect, useRef } from "react";

import { isShallowEqual } from "@excalidraw/common";

import type {
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { isRenderThrottlingEnabled } from "../../reactUtils";

import type { GooglyEyesAnimator } from "../../renderer/googlyEyesScene";
import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "../../scene/types";
import type { AppState, StaticCanvasAppState } from "../../types";
import type { RoughCanvas } from "roughjs/bin/canvas";

type GooglyEyesCanvasProps = {
  animator: GooglyEyesAnimator;
  rc: RoughCanvas;
  elementsMap: RenderableElementsMap;
  allElementsMap: NonDeletedSceneElementsMap;
  visibleElements: readonly NonDeletedExcalidrawElement[];
  canvasNonce: string;
  scale: number;
  appState: AppState;
  renderConfig: StaticCanvasRenderConfig;
};

const getRelevantAppStateProps = (
  appState: AppState,
): StaticCanvasAppState => ({
  zoom: appState.zoom,
  scrollX: appState.scrollX,
  scrollY: appState.scrollY,
  width: appState.width,
  height: appState.height,
  viewModeEnabled: appState.viewModeEnabled,
  openDialog: appState.openDialog,
  hoveredElementIds: appState.hoveredElementIds,
  offsetLeft: appState.offsetLeft,
  offsetTop: appState.offsetTop,
  theme: appState.theme,
  shouldCacheIgnoreZoom: appState.shouldCacheIgnoreZoom,
  viewBackgroundColor: appState.viewBackgroundColor,
  exportScale: appState.exportScale,
  selectedElementsAreBeingDragged: appState.selectedElementsAreBeingDragged,
  gridSize: appState.gridSize,
  gridStep: appState.gridStep,
  frameRendering: appState.frameRendering,
  selectedElementIds: appState.selectedElementIds,
  frameToHighlight: appState.frameToHighlight,
  editingGroupId: appState.editingGroupId,
  currentHoveredFontFamily: appState.currentHoveredFontFamily,
  croppingElementId: appState.croppingElementId,
  suggestedBinding: appState.suggestedBinding,
});

/**
 * The layer the googly eyes are drawn on, between the static scene and the
 * interactive canvas. The pointer moves the pupils through `animator`, which
 * repaints only this canvas.
 */
const GooglyEyesCanvas = (props: GooglyEyesCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { animator } = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    animator.update(
      {
        canvas,
        rc: props.rc,
        scale: props.scale,
        appState: getRelevantAppStateProps(props.appState),
        elementsMap: props.elementsMap,
        allElementsMap: props.allElementsMap,
        visibleElements: props.visibleElements,
        renderConfig: props.renderConfig,
      },
      isRenderThrottlingEnabled(),
    );
  });

  useEffect(() => () => animator.destroy(), [animator]);

  return (
    <canvas
      className="excalidraw__canvas googly-eyes"
      aria-hidden="true"
      style={{
        width: props.appState.width,
        height: props.appState.height,
      }}
      width={props.appState.width * props.scale}
      height={props.appState.height * props.scale}
      ref={canvasRef}
    />
  );
};

const areEqual = (
  prevProps: GooglyEyesCanvasProps,
  nextProps: GooglyEyesCanvasProps,
) => {
  if (
    prevProps.animator !== nextProps.animator ||
    prevProps.canvasNonce !== nextProps.canvasNonce ||
    prevProps.scale !== nextProps.scale ||
    prevProps.rc !== nextProps.rc ||
    prevProps.elementsMap !== nextProps.elementsMap ||
    prevProps.allElementsMap !== nextProps.allElementsMap ||
    prevProps.visibleElements !== nextProps.visibleElements
  ) {
    return false;
  }

  return (
    isShallowEqual(
      getRelevantAppStateProps(prevProps.appState),
      getRelevantAppStateProps(nextProps.appState),
    ) && isShallowEqual(prevProps.renderConfig, nextProps.renderConfig)
  );
};

export default React.memo(GooglyEyesCanvas, areEqual);
