// Whether this is a touch device. Decided once at load; the touch UI (pad, buttons) and the
// keyboard hints are mutually exclusive on it.
export const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
