/**
 * voicelayer-rn — Voice intelligence for React Native
 *
 * Main exports:
 *   VoiceLayerButton     — drop-in floating voice assistant component
 *   useVoiceLayerScreen  — optional hook for per-screen context hints
 *   setVoiceLayerServer  — override server URL (for self-hosting)
 */

export { default as VoiceLayerButton } from './VoiceLayerButton';
export { useVoiceLayerScreen }         from './useVoiceLayerScreen';
export { setVoiceLayerServer }         from './useVoiceIntent';
