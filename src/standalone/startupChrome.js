import { startApplicationChrome } from '../app/startupChrome.js';
import { initKeySetup } from '../keySetup.js';
import { initSystemStatus } from '../ui/systemStatus.js';
import { initAudioSourcesDialog } from '../ui/audioSourcesDialog.js';
import { initAlertsPanel } from '../ui/alertsPanel.js';
import { initVoiceSettings } from '../ui/voiceSettings.js';
import { initGodPanel } from '../ui/godPanel.js';

/** Provider settings (dev server only) plus system status (always). */
async function initStandaloneSettings(options) {
  const status = initSystemStatus(options);
  const audioSources = initAudioSourcesDialog(options);
  const alerts = initAlertsPanel(options);
  const voiceLifetime = new AbortController();
  initVoiceSettings({ ...options, signal: voiceLifetime.signal });
  initGodPanel({ ...options, signal: voiceLifetime.signal });
  const keys = await initKeySetup(options);
  return {
    destroy() {
      status?.destroy();
      audioSources?.destroy();
      alerts?.destroy();
      voiceLifetime.abort();
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
