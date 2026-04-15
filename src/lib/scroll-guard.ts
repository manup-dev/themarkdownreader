/**
 * Tracks whether a programmatic scroll is in progress so that side-effects
 * which otherwise react to "user scrolled to the bottom" (e.g. the
 * Reading-Complete celebration modal) can opt out while we're the ones
 * moving the viewport.
 *
 * Set the flag right before any `scrollIntoView` / `scrollTop = X` that
 * the user didn't directly initiate (CommentsPanel Jump-to, Back-to-top
 * button, etc.). The flag auto-clears after 2 seconds, matching the
 * longest smooth-scroll animation we trigger.
 */

let programmaticUntil = 0

export function markProgrammaticScroll(holdMs = 2000): void {
  programmaticUntil = Date.now() + holdMs
}

export function isProgrammaticScroll(): boolean {
  return Date.now() < programmaticUntil
}
