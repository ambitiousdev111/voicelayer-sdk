// ─────────────────────────────────────────────────────────────────────────────
// VoiceLayer RN — <VoiceLayer /> component
//
// Drop this into any screen. It renders an absolute-positioned floating mic
// button. On first voice command it hits the server; after that, everything
// runs on-device from the LearningStore cache.
//
// Usage:
//   import { VoiceLayer } from 'voicelayer-rn'
//
//   <VoiceLayer
//     proxyUrl="https://your-server.com"
//     appId="repeatly"
//     screenName="CustomerList"
//     language="hi"
//     actions={[
//       {
//         id: 'show-inactive',
//         description: 'Show inactive or expired subscription customers',
//         onTrigger: () => setFilter('inactive'),
//       },
//       {
//         id: 'register-customer',
//         description: 'Register a new customer',
//         params: ['name', 'phone', 'plan'],
//         onTrigger: (params) =>
//           navigation.navigate('CustomerForm', { prefill: params }),
//       },
//     ]}
//   />
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import { MicButton }      from './MicButton'
import { useVoiceLayer }  from './useVoiceLayer'
import type { VoiceLayerProps } from './types'

export const VoiceLayer: React.FC<VoiceLayerProps> = (props) => {
  const { state, transcript, message, toggle } = useVoiceLayer(props)

  return (
    <MicButton
      state={state}
      onPress={toggle}
      color={props.color}
      position={props.position ?? 'bottom-right'}
      transcript={transcript}
      message={message}
    />
  )
}
