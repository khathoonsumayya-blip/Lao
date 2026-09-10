---
name: Mobile booking layout
description: Preventing booking-progress controls from causing mobile horizontal overflow.
---

Scrollable progress steppers inside booking layouts must sit in a grid track that can shrink (`minmax(0, 1fr)`) with a `min-width: 0` content wrapper.

**Why:** A stepper’s max-content labels can otherwise become the grid’s minimum width, expanding the entire page and clipping the review and payment controls on narrow screens.

**How to apply:** When a horizontally scrollable child appears inside a grid or flex item, constrain the parent track before trying to constrain the child itself. Verify the document scroll width at representative 390px and 412px mobile viewports.