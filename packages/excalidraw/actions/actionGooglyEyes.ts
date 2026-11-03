import { arrayToMap } from "@excalidraw/common";

import { CaptureUpdateAction, newElementWith } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  getCustomDataWithGooglyEyes,
  hasGooglyEyes,
  isGooglyEyesEligible,
} from "../renderer/googlyEyes";

import { register } from "./register";

import type { AppClassProperties, AppState, UIAppState } from "../types";

const getEligibleSelectedElements = (
  appState: Pick<AppState | UIAppState, "selectedElementIds">,
  app: AppClassProperties,
) =>
  app.scene
    .getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: false,
    })
    .filter(isGooglyEyesEligible);

/** Remove when every eligible selected element already has eyes, else add. */
const shouldRemoveGooglyEyes = (elements: readonly ExcalidrawElement[]) =>
  elements.length > 0 && elements.every(hasGooglyEyes);

export const actionToggleGooglyEyes = register({
  name: "toggleGooglyEyes",
  label: (elements, appState, app) =>
    shouldRemoveGooglyEyes(getEligibleSelectedElements(appState, app))
      ? "labels.googlyEyes.remove"
      : "labels.googlyEyes.add",
  trackEvent: { category: "element" },
  predicate: (elements, appState, _, app) =>
    getEligibleSelectedElements(appState, app).length > 0,
  perform: (elements, appState, _, app) => {
    const eligibleElements = getEligibleSelectedElements(appState, app);
    if (!eligibleElements.length) {
      return false;
    }

    const nextGooglyEyes = !shouldRemoveGooglyEyes(eligibleElements);
    const elementsToUpdate = arrayToMap(
      // shapes that already have eyes keep them, untouched
      eligibleElements.filter(
        (element) => hasGooglyEyes(element) !== nextGooglyEyes,
      ),
    );

    return {
      elements: elements.map((element) =>
        elementsToUpdate.has(element.id)
          ? newElementWith(
              element,
              {
                customData: getCustomDataWithGooglyEyes(
                  element,
                  nextGooglyEyes,
                ),
              },
              // clearing the last custom data sets it to `undefined`, which
              // `newElementWith` would otherwise treat as no change
              true,
            )
          : element,
      ),
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});
