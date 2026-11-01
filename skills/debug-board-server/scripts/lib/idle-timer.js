"use strict";

// IdleTimer (Entity with a clock). Stops the Server when nobody used it for `idleMs` (0.6.1, ruling R-039):
// no touch on a Page and no call of the Agent. `warnMs` before the end it warns the Pages once.
// Any touch starts the time again. See spec 4.13 and FR-159 to FR-162.

// @purity pure
function warnTimeOf(idleMs, defaultWarnMs) {
  return Math.min(defaultWarnMs, Math.floor(idleMs / 2));
}

// clock: { now(), setTimeout(fn, ms), clearTimeout(id) }. idleMs 0 turns the timer off.
// onWarn(stopAtMs), onClear() (a touch after a warning), onIdle() (the time is over).
// @purity non-pure
function createIdleTimer({ clock, idleMs, warnMs, onWarn, onClear, onIdle }) {
  let warnTimer = null;
  let idleTimer = null;
  let warned = false;
  let stopAtMs = null;

  // @purity non-pure
  function clear() {
    if (warnTimer !== null) clock.clearTimeout(warnTimer);
    if (idleTimer !== null) clock.clearTimeout(idleTimer);
    warnTimer = null;
    idleTimer = null;
  }

  // @purity non-pure
  function start() {
    clear();
    if (!(idleMs > 0)) return;
    stopAtMs = clock.now() + idleMs;
    warnTimer = clock.setTimeout(() => {
      warnTimer = null;
      warned = true;
      onWarn(stopAtMs);
    }, idleMs - warnMs);
    idleTimer = clock.setTimeout(() => {
      idleTimer = null;
      onIdle();
    }, idleMs);
  }

  return Object.freeze({
    // A Page or the Agent did something: the time starts again.
    // @purity non-pure
    touch() {
      if (warned) {
        warned = false;
        onClear();
      }
      start();
    },
    // @purity non-pure
    stop() {
      clear();
    },
    // The time when the Server stops, while a warning is shown; else null.
    warningStopAtMs: () => (warned ? stopAtMs : null),
  });
}

module.exports = { createIdleTimer, warnTimeOf };
