/**
 * VoiceLayer SDK — public surface
 *
 * Primary entry point:
 *   import { VoiceLayer } from 'voicelayer-sdk';
 *   const vl = new VoiceLayer({ anthropicKey: 'sk-ant-...' });
 *   await vl.init();
 */

// ── Top-level facade (VoiceLayer + VoiceLayerConfig) ─────────────────────────
export { VoiceLayer } from './VoiceLayer.js';
export type { VoiceLayerConfig } from './VoiceLayer.js';

// ── Errors ────────────────────────────────────────────────────────────────────
export { VoiceLayerError, ErrorCode } from './errors.js';

// ── Audio layer ───────────────────────────────────────────────────────────────
export { AudioCapture } from './audio/AudioCapture.js';
export { Transcriber }  from './audio/Transcriber.js';
export { TTSPlayer }    from './audio/TTSPlayer.js';
export type { TTSConfig } from './audio/TTSPlayer.js';

// ── Scanner layer ─────────────────────────────────────────────────────────────
export { DOMScanner }    from './scanner/DOMScanner.js';
export { IntentMapper }  from './scanner/IntentMapper.js';
export { RouteDetector } from './scanner/RouteDetector.js';
export type { PageAction, PageIntentMap } from './scanner/types.js';

// ── Observer layer ────────────────────────────────────────────────────────────
export { NetworkObserver } from './observer/NetworkObserver.js';
export { DOMWatcher }      from './observer/DOMWatcher.js';
export type { NetworkEvent }   from './observer/NetworkObserver.js';
export type { DOMChangeEvent } from './observer/DOMWatcher.js';

// ── AI layer ──────────────────────────────────────────────────────────────────
export { IntentEngine }   from './ai/IntentEngine.js';
export type { IntentEngineOptions } from './ai/IntentEngine.js';
export { PromptBuilder }  from './ai/PromptBuilder.js';
export { ResponseParser } from './ai/ResponseParser.js';
export type { AIIntent, IntentRequest, ActionType } from './ai/types.js';

// ── Executor layer ────────────────────────────────────────────────────────────
export { ActionExecutor } from './executor/ActionExecutor.js';
export { DOMInteractor }  from './executor/DOMInteractor.js';
export { FormFiller }     from './executor/FormFiller.js';
export type { ExecutionResult } from './executor/ActionExecutor.js';

// ── UI layer ──────────────────────────────────────────────────────────────────
export { TalkButton }   from './ui/TalkButton.js';
export { VoiceOverlay } from './ui/VoiceOverlay.js';
export { AnnouncerBar } from './ui/AnnouncerBar.js';
export type { TalkButtonState } from './ui/TalkButton.js';
export type { AnnouncerConfig } from './ui/AnnouncerBar.js';

// ── Session layer ─────────────────────────────────────────────────────────────
export { ConversationManager } from './session/ConversationManager.js';
export type { Turn } from './session/ConversationManager.js';

// ── Config helpers ────────────────────────────────────────────────────────────
export { defaults }     from './config/defaults.js';
export { AppDetector }  from './config/AppDetector.js';
export type { AppProfile } from './config/AppDetector.js';

// ── Analytics layer ───────────────────────────────────────────────────────────
export { AnalyticsEngine }  from './analytics/AnalyticsEngine.js';
export { FounderDashboard } from './analytics/FounderDashboard.js';
export { InsightComputer }  from './analytics/InsightComputer.js';
export type {
  VLEvent, VLInsights, VLActionType, VLSource, VLLang,
  CommandStats, TimeSeriesPoint, TopCommand, TopFailure,
} from './analytics/types.js';
