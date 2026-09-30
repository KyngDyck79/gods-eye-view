/** The page's GOD instance and its debug log, shared by voice and the console. */

let current = null;
const debugLog = [];
const listeners = new Set();

export function setGod(god) {
  current = god;
  for (const fn of listeners) fn({ type: 'ready' });
}

export function getGod() {
  return current;
}

/** Record a debug entry (tool call, result, model turn); keeps the last 60. */
export function pushGodDebug(entry) {
  debugLog.push(entry);
  while (debugLog.length > 60) debugLog.shift();
  for (const fn of listeners) fn({ type: 'debug', entry });
}

/** Record a finished exchange so the console shows voice turns too. */
export function pushGodExchange(exchange) {
  for (const fn of listeners) fn({ type: 'exchange', exchange });
}

export function getGodDebug() {
  return debugLog.slice();
}

export function onGodEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
