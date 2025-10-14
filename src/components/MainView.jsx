// components/MainView.jsx - Main view component (80% or 90% of screen)
import React, { useMemo } from 'react';
import { VideoTrack } from '@livekit/components-react';
import ParticipantNameTile from './ParticipantNameTile';

/**
 * MainView renders the main content area showing:
 * - Host's screen share (priority)
 * - Host's camera video 
 * - Host name tile (if no video)
 * - Optional small host video overlay when screen sharing
 */
export default function MainView({ host, screenShareTrack, cameraTrack }) {
  // Determine what to show in main view
  const mainContent = useMemo(() => {
    if (!host) {
      return { type: 'empty' };
    }

    // Priority 1: Screen share
    if (screenShareTrack?.publication?.isSubscribed) {
      return {
        type: 'screen_share',
        trackRef: screenShareTrack,
        hasHostVideo: cameraTrack?.publication?.isSubscribed && !cameraTrack?.publication?.isMuted
      };
    }

    // Priority 2: Host camera
    if (cameraTrack?.publication?.isSubscribed && !cameraTrack?.publication?.isMuted) {
      return {
        type: 'camera',
        trackRef: cameraTrack
      };
    }

    // Priority 3: Host name tile
    return { type: 'name_tile' };
  }, [host, screenShareTrack, cameraTrack]);

  if (!host) {
    return (
      <div 
        className="main-view-empty"
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000',
          color: '#666',
          fontSize: '24px'
        }}
        role="img"
        aria-label="No host present"
      >
        Waiting for host...
      </div>
    );
  }

  return (
    <div 
      className="main-view"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        backgroundColor: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      role="img"
      aria-label={`Main view showing ${mainContent.type.replace('_', ' ')}`}
    >
      {mainContent.type === 'screen_share' && (
        <>
          {/* Screen share content - ensure it fits within container */}
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}
          >
            <VideoTrack
              trackRef={mainContent.trackRef}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain', // Preserve aspect ratio, show full content
                backgroundColor: '#000'
              }}
            />
            
            {/* Host video overlay (small, bottom-right corner) */}
            {mainContent.hasHostVideo && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '20px',
                  right: '20px',
                  width: '200px',
                  height: '150px',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: '2px solid rgba(255, 255, 255, 0.3)',
                  backgroundColor: '#000',
                  zIndex: 10
                }}
              >
                <VideoTrack
                  trackRef={cameraTrack}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                />
                {/* Host name overlay on video */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '4px',
                    left: '4px',
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    color: '#fff',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '500'
                  }}
                >
                  {host.displayName}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {mainContent.type === 'camera' && (
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <VideoTrack
            trackRef={mainContent.trackRef}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain', // Keep aspect ratio, may have letterboxing
              backgroundColor: '#000'
            }}
          />
          
          {/* Host name overlay */}
          <div
            style={{
              position: 'absolute',
              bottom: '20px',
              left: '20px',
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              color: '#fff',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600'
            }}
          >
            {host.displayName}
          </div>
        </div>
      )}

      {mainContent.type === 'name_tile' && (
        <ParticipantNameTile
          participant={host.participant}
          displayName={host.displayName}
          isSpeaking={host.isSpeaking}
          isLarge={true}
          style={{
            width: '400px',
            height: '300px',
            fontSize: '32px'
          }}
        />
      )}
    </div>
  );
}