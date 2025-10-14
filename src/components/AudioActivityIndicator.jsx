// components/AudioActivityIndicator.jsx - Visual indicator for audio activity
import React from 'react';

/**
 * AudioActivityIndicator provides visual feedback for participant audio activity
 * Shows different states: speaking (animated), muted, or idle
 */
export default function AudioActivityIndicator({ 
  isSpeaking = false, 
  isMuted = false,
  size = 'medium',
  style = {} 
}) {
  // Size configurations
  const sizeConfig = {
    small: {
      width: 12,
      height: 12,
      dotSize: 3,
      gap: 1
    },
    medium: {
      width: 16,
      height: 16,
      dotSize: 4,
      gap: 2
    },
    large: {
      width: 20,
      height: 20,
      dotSize: 5,
      gap: 2
    }
  };

  const config = sizeConfig[size] || sizeConfig.medium;

  // Determine indicator state and color
  const getIndicatorState = () => {
    if (isMuted) {
      return {
        color: '#ef4444', // Red for muted
        animation: 'none',
        opacity: 0.8
      };
    }
    
    if (isSpeaking) {
      return {
        color: '#10b981', // Emerald green for speaking
        animation: 'audioActivity 1.5s ease-in-out infinite',
        opacity: 1
      };
    }
    
    return {
      color: '#6b7280', // Gray for idle
      animation: 'none',
      opacity: 0.6
    };
  };

  const indicatorState = getIndicatorState();

  // For muted state, show mute icon
  if (isMuted) {
    return (
      <div
        style={{
          width: config.width,
          height: config.height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style
        }}
        title="Muted"
        aria-label="Microphone muted"
      >
        <svg
          width={config.width}
          height={config.height}
          viewBox="0 0 16 16"
          fill={indicatorState.color}
        >
          <path d="M8 1a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2V1z"/>
          <path d="M6 3a2 2 0 0 0-2 2v1.5a2 2 0 0 0 2 2V3z"/>
          <path d="M3.5 7.5A.5.5 0 0 1 4 7h.5v.5a3.5 3.5 0 0 0 7 0V7H12a.5.5 0 0 1 0 1v.5a4.5 4.5 0 0 1-4 4.472V14h2.5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1H8v-1.028A4.5 4.5 0 0 1 4 8.5V8a.5.5 0 0 1-.5-.5z"/>
          <path d="M1 1l14 14" stroke={indicatorState.color} strokeWidth="1.5"/>
        </svg>
        
        <style jsx>{`
          @keyframes audioActivity {
            0%, 100% {
              opacity: 0.6;
              transform: scale(1);
            }
            50% {
              opacity: 1;
              transform: scale(1.1);
            }
          }
        `}</style>
      </div>
    );
  }

  // For speaking/idle states, show animated dots
  return (
    <div
      style={{
        width: config.width,
        height: config.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: `${config.gap}px`,
        ...style
      }}
      title={isSpeaking ? "Speaking" : "Not speaking"}
      aria-label={isSpeaking ? "Audio activity detected" : "No audio activity"}
    >
      {/* Three animated dots */}
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          style={{
            width: config.dotSize,
            height: config.dotSize,
            borderRadius: '50%',
            backgroundColor: indicatorState.color,
            opacity: indicatorState.opacity,
            animation: isSpeaking 
              ? `audioActivity 1.5s ease-in-out infinite ${index * 0.3}s`
              : 'none',
            transformOrigin: 'center',
            transition: 'all 0.2s ease-in-out'
          }}
        />
      ))}

      <style jsx>{`
        @keyframes audioActivity {
          0%, 20%, 50%, 80%, 100% {
            transform: scale(1);
            opacity: 0.6;
          }
          40% {
            transform: scale(1.3);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}