import { createGevActionRunner } from './gevActions.js';
import { createVoiceCommands } from './commands.js';
import { createLocalVoiceSession } from './local/localSession.js';
import { readVoiceSettings } from './local/settings.js';
export * from './realtimeController.js';

/**
 * Compose the standalone action runner with the voice controls. The engine
 * chosen in Voice settings decides the session: local speech (default,
 * decision 6A) or Web Speech use the local adapter; OpenAI Realtime is
 * opt-in.
 */
export function initGevVoiceCommands(options) {
  const runner = options.runner || createGevActionRunner(options);
  if (readVoiceSettings().engine === 'openai')
    return createVoiceCommands({ ...options, runner });
  const controls = createVoiceCommands({
    ...options,
    runner,
    createSession: (hooks) =>
      createLocalVoiceSession({
        ...hooks,
        handleCommand: options.handleVoiceCommand
          ? (text) => options.handleVoiceCommand(text, hooks)
          : undefined,
      }),
  });
  const kicker = document.querySelector('#gev-voice-control .gev-voice-kicker');
  if (kicker) kicker.textContent = 'VOICE · LOCAL';
  return controls;
}
