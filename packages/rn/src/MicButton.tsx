// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer RN — MicButton
//
// Animated floating mic button. Pulses while listening, spins while processing.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react'
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from 'react-native'
import type { VoiceState } from './types'

interface MicButtonProps {
  state:     VoiceState
  onPress:   () => void
  color?:    string
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center'
  transcript?: string
  message?:    string
}

const ICON: Record<VoiceState, string> = {
  idle:       '🎙',
  listening:  '⏹',   // tap to stop
  processing: '…',
  speaking:   '🔊',
  error:      '⚠️',
}

export const MicButton: React.FC<MicButtonProps> = ({
  state,
  onPress,
  color     = '#6C63FF',
  position  = 'bottom-right',
  transcript = '',
  message    = '',
}) => {
  const pulse  = useRef(new Animated.Value(1)).current
  const pulseAnim = useRef<Animated.CompositeAnimation | null>(null)

  // Pulse animation while listening
  useEffect(() => {
    if (state === 'listening') {
      pulseAnim.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.25, duration: 600, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0,  duration: 600, useNativeDriver: true }),
        ]),
      )
      pulseAnim.current.start()
    } else {
      pulseAnim.current?.stop()
      Animated.spring(pulse, { toValue: 1, useNativeDriver: true }).start()
    }
  }, [state, pulse])

  const containerStyle = [
    styles.container,
    position === 'bottom-right'  && styles.bottomRight,
    position === 'bottom-left'   && styles.bottomLeft,
    position === 'bottom-center' && styles.bottomCenter,
  ]

  const showLabel = state === 'listening' || state === 'speaking' || state === 'processing'
  const label = state === 'listening'
    ? (transcript || 'Listening…')
    : state === 'speaking' || state === 'processing'
    ? (message || 'Processing…')
    : ''

  return (
    <View style={containerStyle}>
      {/* Transcript / response overlay */}
      {showLabel && label ? (
        <View style={styles.label}>
          <Text style={styles.labelText} numberOfLines={3}>{label}</Text>
        </View>
      ) : null}

      {/* Pulse ring behind button while listening */}
      {state === 'listening' && (
        <Animated.View
          style={[
            styles.ring,
            { borderColor: color, transform: [{ scale: pulse }] },
          ]}
        />
      )}

      <Pressable
        onPress={onPress}
        disabled={state === 'processing' || state === 'speaking'}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: state === 'error' ? '#EF4444' : color },
          pressed && styles.buttonPressed,
        ]}
        accessibilityLabel="VoiceLayer mic button"
        accessibilityHint="Tap to start or stop voice command"
        accessibilityRole="button"
      >
        <Animated.View style={{ transform: [{ scale: state === 'listening' ? pulse : 1 }] }}>
          {state === 'processing' ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.icon}>{ICON[state]}</Text>
          )}
        </Animated.View>
      </Pressable>
    </View>
  )
}

const BTN = 56

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom:   24,
    alignItems: 'center',
    zIndex:   999,
  },
  bottomRight: {
    right: 20,
    alignItems: 'flex-end',
  },
  bottomLeft: {
    left: 20,
    alignItems: 'flex-start',
  },
  bottomCenter: {
    alignSelf: 'center',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  button: {
    width:         BTN,
    height:        BTN,
    borderRadius:  BTN / 2,
    alignItems:    'center',
    justifyContent:'center',
    elevation:     6,
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius:  4,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.95 }],
  },
  icon: {
    fontSize: 22,
  },
  ring: {
    position:     'absolute',
    width:        BTN + 16,
    height:       BTN + 16,
    borderRadius: (BTN + 16) / 2,
    borderWidth:  2,
    bottom:       -8,
    opacity:      0.4,
  },
  label: {
    backgroundColor:  'rgba(0,0,0,0.75)',
    borderRadius:     10,
    paddingHorizontal: 12,
    paddingVertical:  8,
    maxWidth:         220,
    marginBottom:     10,
  },
  labelText: {
    color:      '#fff',
    fontSize:   13,
    lineHeight: 18,
    textAlign:  'center',
  },
})
