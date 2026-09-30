import { startApplicationChrome } from '../app/startupChrome.js';
import { initKeySetup } from '../keySetup.js';
import { initSystemStatus } from '../ui/systemStatus.js';
import { initAudioSourcesDialog } from '../ui/audioSourcesDialog.js';

/** Provider settings (dev server only) plus system status (always). */
async function initStandaloneSettings(options) {
  const status = initSystemStatus(options);
  const audioSources = initAudioSourcesDialog(options);
  const keys = await initKeySetup(options);
  return {
    destroy() {
      status?.destroy();
      audioSources?.destroy();
      keys?.destroy();
    },
  };
}

export function startStandaloneChrome(options) {
  return startApplicationChrome({
    initializeSettings: initStandaloneSettings,
    ...options,
  });
}
