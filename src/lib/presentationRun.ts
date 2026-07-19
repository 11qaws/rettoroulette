export interface PresentationRunToken {
  spinKey: number;
  revealId: number;
}

/** A visual completion may mutate draw state only for the run now on air. */
export function isCurrentPresentationCompletion(
  completion: PresentationRunToken,
  currentSpinKey: number,
  currentRevealId: number,
  activePresentationRevealId: number,
) {
  return completion.spinKey === currentSpinKey
    && completion.revealId === currentRevealId
    && completion.revealId === activePresentationRevealId;
}
