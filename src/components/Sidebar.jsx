// components/Sidebar.jsx - Sidebar component (20% or 10% of screen)
import React, { useMemo } from 'react';
import { VideoTrack } from '@livekit/components-react';
import ParticipantNameTile from './ParticipantNameTile';

const MAX_VISIBLE_PARTICIPANTS = 4;

/**
 * Sidebar component that shows co-hosts and participants
 * Split into two sections: co-hosts (top) and participants (bottom)
 */
export default function Sidebar({ coHosts, participants, cameraVideoTracks }) {
  // Get camera tracks for co-hosts
  const coHostTracks = useMemo(() => {
    const trackMap = new Map();
    cameraVideoTracks.forEach(trackRef => {
      trackMap.set(trackRef.participant.identity, trackRef);
    });
    
    return coHosts.map(coHost => ({
      ...coHost,
      cameraTrack: trackMap.get(coHost.identity)
    }));
  }, [coHosts, cameraVideoTracks]);

  // Show only top active participants (speaking first, then others)
  const visibleParticipants = useMemo(() => {
    return participants.slice(0, MAX_VISIBLE_PARTICIPANTS);
  }, [participants]);

  const hiddenParticipantCount = participants.length - visibleParticipants.length;

  return (
    <div 
      className="sidebar"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        gap: '16px'
      }}
      role="complementary"
      aria-label="Participants sidebar"
    >
      {/* Co-hosts Section (Top part) */}
      {coHostTracks.length > 0 && (
        <div
          className="cohost-section"
          style={{
            flex: coHostTracks.length > 0 ? '0 0 auto' : '0',
            maxHeight: '50%',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
          role="region"
          aria-label={`Co-hosts (${coHostTracks.length})`}
        >
          <h3
            style={{
              color: '#fff',
              fontSize: '14px',
              fontWeight: '600',
              margin: '0 0 8px 0',
              opacity: 0.8,
              letterSpacing: '0.5px',
              textTransform: 'uppercase'
            }}
          >
            Co-hosts ({coHostTracks.length})
          </h3>
          
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              overflow: 'auto'
            }}
          >
            {coHostTracks.map(coHost => (
              <CoHostTile
                key={coHost.identity}
                coHost={coHost}
              />
            ))}
          </div>
        </div>
      )}

      {/* Participants Section (Bottom part) */}
      <div
        className="participants-section"
        style={{
          flex: '1',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          minHeight: '0'
        }}
        role="region"
        aria-label={`Participants (${participants.length})`}
      >
        <h3
          style={{
            color: '#fff',
            fontSize: '14px',
            fontWeight: '600',
            margin: '0 0 8px 0',
            opacity: 0.8,
            letterSpacing: '0.5px',
            textTransform: 'uppercase'
          }}
        >
          Participants ({participants.length})
        </h3>
        
        <div
          style={{
            flex: '1',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            overflow: 'auto',
            minHeight: '0'
          }}
        >
          {/* Visible participants */}
          {visibleParticipants.map(participant => (
            <ParticipantNameTile
              key={participant.identity}
              participant={participant.participant}
              displayName={participant.displayName}
              isSpeaking={participant.isSpeaking}
              isCompact={true}
              style={{
                height: '40px',
                fontSize: '14px'
              }}
            />
          ))}
          
          {/* Hidden participants indicator */}
          {hiddenParticipantCount > 0 && (
            <div
              style={{
                height: '36px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ccc',
                fontSize: '13px',
                fontWeight: '500'
              }}
              aria-label={`${hiddenParticipantCount} more participants`}
            >
              +{hiddenParticipantCount} more
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Individual co-host tile component
 */
function CoHostTile({ coHost }) {
  const hasVideo = coHost.cameraTrack?.publication?.isSubscribed && 
                   !coHost.cameraTrack?.publication?.isMuted;

  if (hasVideo) {
    // Co-host with video
    return (
      <div
        style={{
          position: 'relative',
          height: '120px',
          borderRadius: '8px',
          overflow: 'hidden',
          border: coHost.isSpeaking ? '2px solid #10b981' : '1px solid rgba(255, 255, 255, 0.2)',
          backgroundColor: '#000'
        }}
        role="img"
        aria-label={`${coHost.displayName} video`}
      >
        <VideoTrack
          trackRef={coHost.cameraTrack}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
        />
        
        {/* Name overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: '4px',
            left: '4px',
            right: '4px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: '500',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {coHost.displayName}
        </div>
        
        {/* Speaking indicator */}
        {coHost.isSpeaking && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              left: '6px',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              animation: 'pulse 1.5s ease-in-out infinite'
            }}
            aria-label="Speaking"
          />
        )}
      </div>
    );
  }

  // Co-host audio-only (compact name tile)
  return (
    <ParticipantNameTile
      participant={coHost.participant}
      displayName={coHost.displayName}
      isSpeaking={coHost.isSpeaking}
      isCompact={true}
      style={{
        height: '48px',
        fontSize: '14px'
      }}
    />
  );
}