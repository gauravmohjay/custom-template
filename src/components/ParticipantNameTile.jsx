// components/ParticipantNameTile.jsx - Name tile with audio activity indicator
import React from 'react';
import { useIsSpeaking } from '@livekit/components-react';
import { TrackMutedIndicator } from '@livekit/components-react';
import AudioActivityIndicator from './AudioActivityIndicator';

/**
 * ParticipantNameTile displays participant name with audio activity indication
 * Used for participants without video or as fallback display
 */
export default function ParticipantNameTile({ 
  participant, 
  displayName, 
  isSpeaking, 
  isLarge = false, 
  isCompact = false,
  style = {} 
}) {
  // Use LiveKit hook for real-time speaking status (more reliable than prop)
  const speakingFromHook = useIsSpeaking(participant);
  const finalIsSpeaking = isSpeaking || speakingFromHook;

  // Calculate styles based on size
  const tileStyles = {
    width: '100%',
    height: isLarge ? '200px' : isCompact ? '36px' : '60px',
    backgroundColor: finalIsSpeaking 
      ? 'rgba(16, 185, 129, 0.15)' // Emerald green tint when speaking
      : 'rgba(255, 255, 255, 0.08)',
    border: finalIsSpeaking 
      ? '2px solid #10b981' // Emerald green border when speaking
      : '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: isLarge ? '12px' : '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: isLarge ? 'center' : 'flex-start',
    padding: isLarge ? '24px' : isCompact ? '8px 12px' : '12px 16px',
    color: '#fff',
    fontSize: isLarge ? '24px' : isCompact ? '13px' : '14px',
    fontWeight: isLarge ? '700' : '600',
    position: 'relative',
    transition: 'all 0.2s ease-in-out',
    cursor: 'default',
    ...style
  };

  return (
    <div
      style={tileStyles}
      role="img"
      aria-label={`${displayName}${finalIsSpeaking ? ', speaking' : ', not speaking'}`}
    >
      {/* Audio activity indicator */}
      <AudioActivityIndicator
        isSpeaking={finalIsSpeaking}
        size={isLarge ? 'large' : isCompact ? 'small' : 'medium'}
        style={{
          marginRight: isLarge ? '16px' : '8px',
          flexShrink: 0
        }}
      />

      {/* Participant name */}
      <span
        style={{
          flex: 1,
          textAlign: isLarge ? 'center' : 'left',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          lineHeight: '1.2'
        }}
      >
        {displayName}
      </span>

      {/* Mute indicator (if applicable) */}
      {!isLarge && (
        <div
          style={{
            marginLeft: '8px',
            flexShrink: 0,
            opacity: 0.7
          }}
        >
          <TrackMutedIndicator
            trackRef={{
              participant,
              source: 'microphone',
              publication: participant?.audioTracks?.values()?.next()?.value
            }}
            show="muted"
          />
        </div>
      )}

      {/* Speaking pulse effect for large tiles */}
      {finalIsSpeaking && isLarge && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '100%',
            height: '100%',
            border: '2px solid rgba(16, 185, 129, 0.4)',
            borderRadius: '12px',
            animation: 'speakingPulse 2s ease-in-out infinite',
            pointerEvents: 'none'
          }}
        />
      )}

      {/* CSS animations embedded as a style tag */}
      <style jsx>{`
        @keyframes speakingPulse {
          0%, 100% {
            opacity: 0.4;
            transform: translate(-50%, -50%) scale(1);
          }
          50% {
            opacity: 0.8;
            transform: translate(-50%, -50%) scale(1.05);
          }
        }
        
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
        }
      `}</style>
    </div>
  );
}