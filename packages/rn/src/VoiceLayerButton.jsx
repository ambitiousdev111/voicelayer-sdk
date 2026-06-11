/**
 * VoiceLayerButton — zero-config floating voice assistant for React Native.
 *
 * ┌─ Minimal integration (3 lines total) ────────────────────────────────────┐
 * │                                                                           │
 * │  // 1. In your navigation file (you probably have this already):          │
 * │  export const navigationRef = createNavigationContainerRef()              │
 * │                                                                           │
 * │  // 2. Wire the ref:                                                      │
 * │  <NavigationContainer ref={navigationRef}>                                │
 * │                                                                           │
 * │  // 3. Drop the button anywhere inside NavigationContainer:               │
 * │  <VoiceLayerButton navigationRef={navigationRef} apiKey="vl-xxx" />       │
 * │                                                                           │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Props:
 *   navigationRef   NavigationContainerRef   REQUIRED — your app's ref
 *   apiKey          string                   REQUIRED — get one at voicelayer.dev
 *   screenNames?    string[]                 push-only or parameterised screens
 *                                            e.g. ['CheckoutScreen','OrderScreen:orderId']
 *   appId?          string                   for analytics grouping (default: 'app')
 *   language?       string                   'hi' | 'en' | 'auto' (default: 'hi')
 *   serverUrl?      string                   override for self-hosting
 *
 * Intelligence layers (all automatic):
 *   1. Screen auto-discovery — reads navigation state
 *   2. Current screen context — tells Claude where user is
 *   3. Param extraction — 'OrderScreen:orderId' → navigate with params
 *   4. Context-aware chips — always relevant to current screen
 *   5. Navigation history — powers "wapas jaao"
 *   6. useVoiceLayerScreen — optional per-screen hints
 *   7. Multi-turn conversation — pronoun resolution across commands
 */

import React, {
  useState, useRef, useCallback, useEffect,
} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, TextInput, ActivityIndicator,
  Animated, KeyboardAvoidingView, Platform,
  Pressable, ScrollView,
} from 'react-native';
import { useNavigationState } from '@react-navigation/native';

import { useVoiceIntent, setVoiceLayerServer } from './useVoiceIntent';
import { screenRegistry }                       from './screenRegistry';
import { navigationHistory }                    from './navigationHistory';
import { conversationStore }                    from './conversationStore';

const ACCENT  = '#4CAF50';
const DARK_BG = '#161616';

// ── Route utilities ───────────────────────────────────────────────────────────

function extractRoutes(state, containerName = null) {
  if (!state?.routes) return [];
  const result = [];
  for (const route of state.routes) {
    if (route.state?.routes?.length > 0) {
      result.push(...extractRoutes(route.state, route.name));
    } else {
      result.push({ name: route.name, container: containerName, paramKeys: [] });
    }
  }
  return result;
}

function parseScreenHint(hint) {
  if (typeof hint !== 'string') return { name: String(hint), paramKeys: [] };
  const [name, paramStr = ''] = hint.split(':');
  return {
    name:      name.trim(),
    paramKeys: paramStr ? paramStr.split(',').map(p => p.trim()).filter(Boolean) : [],
  };
}

function buildRoutes(navRef, screenNames = []) {
  if (!navRef?.isReady()) return [];

  const state     = navRef.getRootState();
  const auto      = extractRoutes(state);
  const autoNames = new Set(auto.map(r => r.name));

  const hintMap = new Map(
    screenNames.map(parseScreenHint).map(({ name, paramKeys }) => [name, paramKeys])
  );

  const merged = auto.map(r => ({
    ...r,
    paramKeys: hintMap.get(r.name) ?? [],
  }));

  const extras = screenNames
    .map(parseScreenHint)
    .filter(({ name }) => !autoNames.has(name))
    .map(({ name, paramKeys }) => ({ name, container: null, paramKeys }));

  return [...merged, ...extras];
}

function routeToLabel(name) {
  return name
    .replace(/Screen$|Navigator$|Tab$/i, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase()) || name;
}

function buildContextualChips(currentScreenName, allRoutes, screenMeta) {
  const chips = [], used = new Set();

  const add = (label) => {
    const key = label.toLowerCase();
    if (!used.has(key)) { chips.push(label); used.add(key); }
  };

  // 1. Per-screen hints from useVoiceLayerScreen (most specific)
  if (screenMeta?.hints?.length > 0) {
    screenMeta.hints.slice(0, 3).forEach(h =>
      add(h.charAt(0).toUpperCase() + h.slice(1))
    );
  }

  // 2. Sibling screens (same tab/container)
  const currentContainer = allRoutes.find(r => r.name === currentScreenName)?.container ?? null;
  allRoutes
    .filter(r => r.name !== currentScreenName && r.container === currentContainer)
    .slice(0, 4)
    .forEach(r => add(routeToLabel(r.name)));

  // 3. Fill to 6 with any remaining screens
  allRoutes
    .filter(r => r.name !== currentScreenName && !used.has(routeToLabel(r.name).toLowerCase()))
    .slice(0, 6 - chips.length)
    .forEach(r => add(routeToLabel(r.name)));

  return chips.slice(0, 6);
}

// ── Waveform animation ────────────────────────────────────────────────────────

function Waveform({ active }) {
  const bars = [
    useRef(new Animated.Value(0.4)).current,
    useRef(new Animated.Value(0.4)).current,
    useRef(new Animated.Value(0.4)).current,
    useRef(new Animated.Value(0.4)).current,
    useRef(new Animated.Value(0.4)).current,
  ];

  useEffect(() => {
    if (!active) {
      bars.forEach(b =>
        Animated.timing(b, { toValue: 0.4, duration: 200, useNativeDriver: true }).start()
      );
      return;
    }
    const anims = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 80),
          Animated.timing(b, { toValue: 1,   duration: 300, useNativeDriver: true }),
          Animated.timing(b, { toValue: 0.4, duration: 300, useNativeDriver: true }),
        ])
      )
    );
    anims.forEach(a => a.start());
    return () => anims.forEach(a => a.stop());
  }, [active]);

  return (
    <View style={waveStyles.row}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[
            waveStyles.bar,
            { transform: [{ scaleY: b }], backgroundColor: active ? ACCENT : '#555' },
          ]}
        />
      ))}
    </View>
  );
}

const waveStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32 },
  bar: { width: 4, height: 28, borderRadius: 2 },
});

// ── Main component ────────────────────────────────────────────────────────────

export default function VoiceLayerButton({
  navigationRef,
  apiKey,
  screenNames = [],
  appId       = 'app',
  language    = 'hi',
  serverUrl,          // optional: overrides default https://api.voicelayer.dev
}) {
  // Apply server URL override once, synchronously
  if (serverUrl) setVoiceLayerServer(serverUrl);

  if (!navigationRef) {
    console.error('[VoiceLayer] navigationRef prop is required.');
  }
  if (!apiKey) {
    console.warn('[VoiceLayer] apiKey prop missing. Get one at voicelayer.dev.');
  }

  const [sheetVisible, setSheetVisible] = useState(false);
  const [inputText,    setInputText]    = useState('');
  const [listening,    setListening]    = useState(false);
  const [toastState,   setToastState]   = useState(null);
  const [chips,        setChips]        = useState([]);

  const inputRef = useRef(null);
  const fabPulse = useRef(new Animated.Value(1)).current;
  const loopAnim = useRef(null);

  const { resolve, loading } = useVoiceIntent({ apiKey, appId, language });

  // [5] Init navigation history on mount (with retry until nav is ready)
  useEffect(() => {
    if (!navigationRef) return;
    const tryInit = () => {
      if (navigationRef.isReady()) {
        navigationHistory.init(navigationRef);
      } else {
        const t = setTimeout(tryInit, 200);
        return () => clearTimeout(t);
      }
    };
    tryInit();
  }, [navigationRef]);

  // Build full context snapshot at command-submit time (freshest possible)
  const buildContext = useCallback(() => {
    const allRoutes    = buildRoutes(navigationRef, screenNames);
    const currentRoute = navigationRef?.isReady() ? navigationRef.getCurrentRoute() : null;
    const currentName  = currentRoute?.name ?? null;
    const screenMeta   = currentName ? screenRegistry.get(currentName) : null;
    const recentScreens = navigationHistory.getRecent(6);
    const contextChips  = buildContextualChips(currentName, allRoutes, screenMeta);
    return { allRoutes, currentRoute, currentName, screenMeta, recentScreens, contextChips };
  }, [navigationRef, screenNames]);

  const openSheet = useCallback(() => {
    const ctx = buildContext();
    setChips(ctx.contextChips);
    setInputText('');
    setListening(false);
    setSheetVisible(true);
  }, [buildContext]);

  // FAB pulse while waiting for response
  const startPulse = useCallback(() => {
    loopAnim.current = Animated.loop(
      Animated.sequence([
        Animated.timing(fabPulse, { toValue: 1.18, duration: 500, useNativeDriver: true }),
        Animated.timing(fabPulse, { toValue: 1,    duration: 500, useNativeDriver: true }),
      ])
    );
    loopAnim.current.start();
  }, [fabPulse]);

  const stopPulse = useCallback(() => {
    loopAnim.current?.stop();
    fabPulse.setValue(1);
  }, [fabPulse]);

  const showToast = useCallback((kind, text, ms = 3500) => {
    setToastState({ kind, text });
    setTimeout(() => setToastState(null), ms);
  }, []);

  // Navigate — with canGoBack guard + case-insensitive name matching
  const executeRoute = useCallback(({ name, container }, params = {}) => {
    if (!navigationRef?.isReady()) return false;

    if (name === '__back__') {
      if (navigationRef.canGoBack()) {
        navigationRef.goBack();
      } else {
        showToast('info', 'Pehle koi screen nahi hai');
      }
      return true;
    }

    // Case-insensitive fallback if Claude returns slight name variation
    const state     = navigationRef.getRootState();
    const allKnown  = extractRoutes(state).map(r => r.name);
    const exact     = allKnown.find(n => n === name);
    const fuzzy     = !exact && allKnown.find(n => n.toLowerCase() === name.toLowerCase());
    const resolved  = exact ?? fuzzy ?? name;

    if (container) {
      navigationRef.navigate(container, { screen: resolved, params });
    } else {
      navigationRef.navigate(resolved, Object.keys(params).length > 0 ? params : undefined);
    }
    return true;
  }, [navigationRef, showToast]);

  // Core submit — build context, call server, navigate
  const submit = useCallback(async (text) => {
    const cmd = text.trim();
    if (!cmd) return;

    const ctx = buildContext();
    setSheetVisible(false);
    setInputText('');
    setListening(false);
    startPulse();
    showToast('loading', 'Samajh raha hoon…');

    // [7] Add to conversation history before resolving
    conversationStore.addUser(cmd);

    try {
      const result = await resolve(cmd, ctx);
      stopPulse();

      const hasRoute = !!result.route?.name;
      showToast(hasRoute ? 'success' : 'info', result.speak || 'Samajh nahi aaya');

      if (result.speak) conversationStore.addAssistant(result.speak);
      if (hasRoute) executeRoute(result.route, result.params ?? {});
    } catch {
      stopPulse();
      conversationStore.clear(); // stale context could mislead next command
      showToast('error', 'Server se connect nahi ho paya. API key sahi hai?', 5000);
    }
  }, [resolve, buildContext, executeRoute, startPulse, stopPulse, showToast]);

  const handleMicPress = useCallback(() => {
    if (listening) {
      setListening(false);
      if (inputText.trim()) submit(inputText);
    } else {
      setListening(true);
      // Wire @react-native-voice/voice here for real STT on physical devices.
      // Falls back to text input focus on emulator — works for demos.
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [listening, inputText, submit]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Floating mic button */}
      <Animated.View style={[styles.fab, { transform: [{ scale: fabPulse }] }]}>
        <TouchableOpacity
          style={[styles.fabInner, loading && styles.fabInnerActive]}
          onPress={openSheet}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.fabIcon}>🎙</Text>}
        </TouchableOpacity>
      </Animated.View>

      {/* Response toast */}
      {toastState && (
        <View style={[
          styles.toast,
          toastState.kind === 'error'   && styles.toastError,
          toastState.kind === 'success' && styles.toastSuccess,
        ]}>
          {toastState.kind === 'loading'
            ? <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
            : <Text style={styles.toastIcon}>
                {toastState.kind === 'success' ? '✓' : toastState.kind === 'error' ? '✕' : 'ℹ'}
              </Text>
          }
          <Text style={styles.toastText} numberOfLines={3}>{toastState.text}</Text>
        </View>
      )}

      {/* Bottom sheet */}
      <Modal
        visible={sheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.overlay}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheetVisible(false)} />

          <View style={styles.sheet}>
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={styles.headerLeft}>
                <Text style={styles.headerIcon}>🎙</Text>
                <Text style={styles.headerTitle}>VoiceLayer</Text>
              </View>
              <TouchableOpacity
                onPress={() => setSheetVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Context-aware chips */}
            {chips.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.chipsScroll}
                  contentContainerStyle={styles.chipsContent}
                >
                  {chips.map(chip => (
                    <TouchableOpacity
                      key={chip}
                      style={styles.chip}
                      onPress={() => submit(chip)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.chipIcon}>⚡</Text>
                      <Text style={styles.chipText}>{chip}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            {/* Input row */}
            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={inputText}
                onChangeText={setInputText}
                placeholder="Ya type karo kuch bhi…"
                placeholderTextColor="#555"
                returnKeyType="send"
                onSubmitEditing={() => submit(inputText)}
              />
              <TouchableOpacity
                style={[styles.micBtn, listening && styles.micBtnActive]}
                onPress={handleMicPress}
                activeOpacity={0.8}
              >
                <Text style={styles.micIcon}>{listening ? '■' : '🎙'}</Text>
              </TouchableOpacity>
              {inputText.trim().length > 0 && (
                <TouchableOpacity
                  style={styles.sendBtn}
                  onPress={() => submit(inputText)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.sendIcon}>↑</Text>
                </TouchableOpacity>
              )}
            </View>

            {listening && (
              <View style={styles.waveRow}>
                <Waveform active />
                <Text style={styles.listeningLabel}>Sun raha hoon…</Text>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  fab: {
    position: 'absolute', bottom: 90, left: 20,
    zIndex: 100, elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 5,
  },
  fabInner: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: ACCENT,
    alignItems: 'center', justifyContent: 'center',
  },
  fabInnerActive: { backgroundColor: '#388E3C' },
  fabIcon: { fontSize: 22 },

  toast: {
    position: 'absolute', bottom: 155, left: 16, right: 80,
    backgroundColor: 'rgba(20,20,20,0.93)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center',
    zIndex: 99, elevation: 8,
  },
  toastError:   { backgroundColor: 'rgba(180,0,0,0.9)' },
  toastSuccess: { backgroundColor: 'rgba(30,100,30,0.93)' },
  toastIcon:    { color: '#fff', marginRight: 8, fontSize: 15, fontWeight: '700' },
  toastText:    { color: '#fff', fontSize: 13, flex: 1, lineHeight: 19 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: DARK_BG,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 20, paddingBottom: 32, paddingTop: 12,
  },
  handle: {
    alignSelf: 'center', width: 38, height: 4,
    borderRadius: 2, backgroundColor: '#333', marginBottom: 14,
  },

  sheetHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 20,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIcon:  { fontSize: 18 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  closeBtn:    { color: '#666', fontSize: 18, fontWeight: '600' },

  sectionLabel: {
    color: '#555', fontSize: 11, fontWeight: '600',
    letterSpacing: 0.8, marginBottom: 10,
  },
  chipsScroll:   { marginBottom: 16 },
  chipsContent:  { gap: 8, paddingRight: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#222', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#2e2e2e',
  },
  chipIcon:  { fontSize: 11, marginRight: 4 },
  chipText:  { color: '#ccc', fontSize: 13 },

  inputRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, backgroundColor: '#222', borderRadius: 12,
    borderWidth: 1, borderColor: '#2e2e2e',
    color: '#fff', fontSize: 15,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  micBtn: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: '#333', alignItems: 'center', justifyContent: 'center',
  },
  micBtnActive: { backgroundColor: '#c0392b' },
  micIcon:      { fontSize: 18 },
  sendBtn: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center',
  },
  sendIcon: { color: '#fff', fontSize: 20, fontWeight: '800' },

  waveRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  listeningLabel: { color: ACCENT, fontSize: 13 },
});
