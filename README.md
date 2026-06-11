# VoiceLayer SDK

Make any web app voice-controlled in one script tag. Supports Hindi, English, and Hinglish out of the box.

[![npm version](https://img.shields.io/npm/v/voicelayer-sdk)](https://npmjs.com/package/voicelayer-sdk)
[![gzip size](https://img.shields.io/bundlephobia/minzip/voicelayer-sdk)](https://bundlephobia.com/package/voicelayer-sdk)

---

## Install

### Script tag — zero config

Add one tag to your HTML. An orange mic button appears. Users can speak to your app immediately.

```html
<script
  src="https://unpkg.com/voicelayer-sdk/dist/voicelayer.iife.js"
  data-anthropic-key="sk-ant-YOUR_KEY"
></script>
```

Or with OpenAI (Whisper STT + GPT-4o intent):

```html
<script
  src="https://unpkg.com/voicelayer-sdk/dist/voicelayer.iife.js"
  data-openai-key="sk-YOUR_KEY"
  data-tts-provider="browser"
></script>
```

**That's it.** VoiceLayer auto-detects your framework (React, Vue, Next.js, Angular, vanilla),
language (Hindi/English), and router type. No selectors, no page maps, no configuration needed.

### npm

```bash
npm install voicelayer-sdk
```

```js
import { VoiceLayer } from 'voicelayer-sdk';

const vl = new VoiceLayer({
  anthropicKey: 'sk-ant-...',  // or openaiKey
});
await vl.init();
```

---

## Script tag attributes

| Attribute | Description | Default |
|---|---|---|
| `data-anthropic-key` | Anthropic API key (Claude intent engine) | — |
| `data-openai-key` | OpenAI API key (Whisper STT + GPT-4o fallback) | — |
| `data-tts-provider` | `browser` \| `openai` \| `elevenlabs` | auto |
| `data-language` | `hi` \| `en` \| `auto` | `auto` |
| `data-debug` | `true` to enable verbose console logs | `false` |

---

## Optional: Better navigation with React Router

For React Router v6, add the bridge component so VoiceLayer uses `useNavigate` instead of `history.pushState`:

```jsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function VoiceLayerBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e) => navigate(e.detail.href);
    window.addEventListener('voicelayer:navigate', handler);
    return () => window.removeEventListener('voicelayer:navigate', handler);
  }, [navigate]);

  return null;
}

// Add <VoiceLayerBridge /> inside your <Router> once
```

---

## Optional: Label elements for better recognition

Add `data-voice-label` to elements with dynamic or icon-only text so VoiceLayer
can find them even when selectors shift:

```html
<button data-voice-label="Add to cart" aria-label="Add to cart">
  <svg>...</svg>
</button>
```

```html
<a href="/orders" data-voice-label="Today's Orders">📦</a>
```

---

## How it works

1. **Mic** — User presses the floating button (or `Space` / `Alt+V`). AudioCapture records.
2. **STT** — Audio is transcribed by Whisper (OpenAI) or Web Speech API.
3. **AI** — Claude or GPT-4o reads the live DOM snapshot and resolves the user's intent to a concrete action.
4. **Execute** — DOMInteractor fires the action (click, fill, navigate) using the host app's own event system so React/Vue handlers work correctly.

---

## Cost estimate

| Volume | Claude (Haiku) | OpenAI (GPT-4o mini) |
|---|---|---|
| 1 000 voice commands | ~$0.04 | ~$0.06 |
| 10 000 commands | ~$0.40 | ~$0.60 |
| 100 000 commands | ~$4.00 | ~$6.00 |

*STT via Whisper: ~$0.006 per minute of audio.*

---

## Configuration reference

```ts
new VoiceLayer({
  // AI provider — pick one
  anthropicKey: 'sk-ant-...',
  openaiKey:    'sk-...',

  // STT backend (default: whisper when openaiKey set, webspeech otherwise)
  stt: 'whisper' | 'webspeech',

  // TTS backend
  tts: {
    provider: 'browser' | 'openai' | 'elevenlabs',
    voiceId:  'optional-elevenlabs-voice-id',
    speed:    1.0,
  },

  // UI
  ui: {
    buttonPosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left',
    buttonColor:    '#6C47FF',
  },

  // Language hint (auto-detected when not set)
  language: 'hi' | 'en' | 'auto',

  // Same-origin proxies for browser demos (avoids CORS)
  anthropicProxyUrl: '/api/anthropic',
  openaiProxyUrl:    '/api/openai',

  // Behaviours
  debug:            false,
  announceToasts:   true,
  announceModals:   true,
  rescanOnMutation: true,
})
```

---

## Events

VoiceLayer fires custom events on `window` you can listen to:

```js
window.addEventListener('voicelayer:action:start',   (e) => console.log('started', e.detail));
window.addEventListener('voicelayer:action:success',  (e) => console.log('done',    e.detail));
window.addEventListener('voicelayer:action:error',    (e) => console.log('error',   e.detail));
```

---

## Browser support

Chrome 88+, Edge 88+, Firefox 90+, Safari 15.4+.  
Web Speech API (free STT) requires Chrome/Edge.

---

## License

MIT
