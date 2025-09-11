// src/App.jsx - Complete Role-Aware Recording Template with Updated Layout
import React, { useEffect, useRef, useState, useCallback } from "react";
import { LiveKitRoom, useRoomContext, RoomAudioRenderer } from "@livekit/components-react";
import { Track } from "livekit-client";
import EgressHelper from "@livekit/egress-sdk";

function parseDisplayName(metadata, identity) {
  if (!metadata) return identity;
  try {
    const parsed = JSON.parse(metadata);
    if (parsed?.displayName) return parsed.displayName;
    if (parsed?.name) return parsed.name;
    if (parsed?.username) return parsed.username;
  } catch (e) {
    // not JSON
  }
  if (typeof metadata === "string" && metadata.length < 64) return metadata;
  return identity;
}

// Function to extract role from metadata
function parseRole(metadata) {
  if (!metadata) return "participant";
  try {
    const parsed = JSON.parse(metadata);
    const role = parsed?.role;
    if (role === "host" || role === "coHost" || role === "participant") {
      return role;
    }
    return "participant";
  } catch (e) {
    return "participant";
  }
}

function useParticipants(room) {
  const [participants, setParticipants] = useState(new Map());

  const setParticipant = useCallback((identity, updater) => {
    setParticipants((prev) => {
      const next = new Map(prev);
      const existing = next.get(identity) || { 
        identity, 
        displayName: identity, 
        videoTrack: null, 
        audioTrack: null, 
        speaking: false,
        audioLevel: 0,
        role: "participant",
        isRecorder: false,
        lastSpokeAt: 0,
        joinedAt: Date.now()
      };
      const updated = typeof updater === "function" ? updater(existing) : { ...existing, ...updater };
      next.set(identity, updated);
      return next;
    });
  }, []);

  const removeParticipant = useCallback((identity) => {
    setParticipants((prev) => {
      const next = new Map(prev);
      next.delete(identity);
      return next;
    });
  }, []);

  return { participants, setParticipant, removeParticipant, setParticipants };
}

// Notification component for join/leave events
function NotificationToast({ notifications }) {
  if (!notifications.length) return null;
  
  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <div 
          key={notification.id} 
          className={`notification ${notification.type} ${notification.isVisible ? 'show' : 'hide'}`}
        >
          <div className="notification-icon">
            {notification.type === 'join' ? '👋' : '👋'}
          </div>
          <div className="notification-content">
            <div className="notification-title">
              {notification.type === 'join' ? 'Participant Joined' : 'Participant Left'}
            </div>
            <div className="notification-message">
              <span className={`role-indicator ${notification.role}`}>
                {notification.role === 'coHost' ? 'coHost' : notification.role.toUpperCase()}
              </span>
              {notification.displayName}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateInner() {
  const room = useRoomContext();
  const { participants, setParticipant, removeParticipant, setParticipants } = useParticipants(room);
  const startedRef = useRef(false);
  const snapshotTimerRef = useRef(null);
  const speakingTimerRef = useRef(null);
  const analyserMapRef = useRef(new Map());
  
  // Notification state
  const [notifications, setNotifications] = useState([]);

  // Function to show notifications - FIXED
  const showNotification = useCallback((type, displayName, role) => {
    const id = Date.now() + Math.random();
    const notification = {
      id,
      type,
      displayName,
      role,
      isVisible: false
    };

    setNotifications(prev => [...prev, notification]);

    // Show notification
    setTimeout(() => {
      setNotifications(prev => 
        prev.map(n => n.id === id ? { ...n, isVisible: true } : n)
      );
    }, 100);

    // Hide notification
    setTimeout(() => {
      setNotifications(prev => 
        prev.map(n => n.id === id ? { ...n, isVisible: false } : n)
      );
    }, 4000);

    // Remove notification
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4500);
  }, []);

  useEffect(() => {
    if (!room) return;

    try {
      EgressHelper.setRoom(room);
    } catch (e) {
      console.warn("DIAG_EGRESS_HELPER_SETROOM_FAILED", e);
    }

    console.log("DIAG_ROOM_INIT", {
      localIdentity: room.localParticipant?.identity,
      remoteCount: room.remoteParticipants?.size,
    });

    // Function to determine if participant is recorder (egress)
    const isRecorderParticipant = (participant) => {
      const identity = participant.identity;
      const metadata = participant.metadata;
      
      return (
        identity?.toLowerCase().includes('egress') ||
        identity?.toLowerCase().includes('recorder') ||
        identity?.toLowerCase().includes('recording') ||
        metadata?.toLowerCase().includes('egress') ||
        metadata?.toLowerCase().includes('recorder') ||
        participant.kind === 'egress' ||
        (participant.trackPublications && participant.trackPublications.size === 0)
      );
    };

    const addOrUpdateParticipant = (p) => {
      // Extract role from _attributes first, fallback to metadata
      const roleFromAttributes = p._attributes?.role;
      const role = roleFromAttributes || parseRole(p.metadata);
      const displayName = parseDisplayName(p.metadata, p.identity);
      const isRecorder = isRecorderParticipant(p);
      
      if (isRecorder) {
        console.log("DIAG_SKIPPING_RECORDER", { identity: p.identity, metadata: p.metadata });
        return;
      }
      
      setParticipant(p.identity, ex => ({
        ...ex,
        displayName,
        role,
        isRecorder: false,
        joinedAt: ex.joinedAt || Date.now(),
        speaking: ex.speaking || false,
      }));
      console.log("DIAG_PARTICIPANT_ADD", { identity: p.identity, metadata: p.metadata, role, isRecorder });
    };

    const onParticipantConnected = (p) => {
      console.log("DIAG_EVENT_participantConnected", { identity: p.identity });
      const roleFromAttributes = p._attributes?.role;
      const role = roleFromAttributes || parseRole(p.metadata);
      const displayName = parseDisplayName(p.metadata, p.identity);
      const isRecorder = isRecorderParticipant(p);
      
      if (!isRecorder) {
        addOrUpdateParticipant(p);
        showNotification('join', displayName, role);
      }
    };

    const onParticipantDisconnected = (p) => {
      console.log("DIAG_EVENT_participantDisconnected", { identity: p.identity });
      const roleFromAttributes = p._attributes?.role;
      const role = roleFromAttributes || parseRole(p.metadata);
      const displayName = parseDisplayName(p.metadata, p.identity);
      const isRecorder = isRecorderParticipant(p);
      
      if (!isRecorder) {
        showNotification('leave', displayName, role);
      }
      
      const a = analyserMapRef.current.get(p.identity);
      if (a?.ctx && a?.ctx.close) {
        try { a.ctx.close(); } catch {}
      }
      analyserMapRef.current.delete(p.identity);
      removeParticipant(p.identity);
    };

    const attachAudioAnalyser = (identity, track) => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const msTrack = track.mediaStreamTrack;
        if (!msTrack) return;
        const stream = new MediaStream([msTrack]);
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        src.connect(analyser);
        analyserMapRef.current.set(identity, { ctx, analyser });
        console.log("DIAG_AUDIO_ANALYSER_ATTACHED", { identity });
      } catch (e) {
        console.warn("DIAG_attachAudioAnalyser_failed", e);
      }
    };

    const onTrackSubscribed = (track, publication, participant) => {
      const id = participant.identity;
      
      if (isRecorderParticipant(participant)) {
        console.log("DIAG_SKIPPING_RECORDER_TRACK", { identity: id, kind: publication.kind });
        return;
      }
      
      console.log("DIAG_EVENT_trackSubscribed", {
        participant: id,
        kind: publication.kind,
        source: publication.source,
        trackSid: publication.trackSid,
        isSubscribed: publication.isSubscribed,
        hasMediaStreamTrack: !!track.mediaStreamTrack,
      });

      const roleFromAttributes = participant._attributes?.role;
      const role = roleFromAttributes || parseRole(participant.metadata);

      if (track.kind === Track.Kind.Video) {
        setParticipant(id, (ex) => ({ ...ex, videoTrack: track, role }));
      } else if (track.kind === Track.Kind.Audio) {
        setParticipant(id, (ex) => ({ ...ex, audioTrack: track, role }));
        attachAudioAnalyser(id, track);
      }
    };

    const onTrackUnsubscribed = (track, publication, participant) => {
      const id = participant.identity;
      console.log("DIAG_EVENT_trackUnsubscribed", { participant: id, kind: publication.kind });
      if (publication.kind === Track.Kind.Video) {
        setParticipant(id, (ex) => ({ ...ex, videoTrack: null }));
      } else if (publication.kind === Track.Kind.Audio) {
        setParticipant(id, (ex) => ({ ...ex, audioTrack: null }));
        const a = analyserMapRef.current.get(id);
        if (a?.ctx && a.ctx.close) try { a.ctx.close(); } catch {}
        analyserMapRef.current.delete(id);
      }
    };

    // Hydrate existing participants
    try {
      const local = room.localParticipant;
      if (local && !isRecorderParticipant(local)) {
        const roleFromAttributes = local._attributes?.role;
        const role = roleFromAttributes || parseRole(local.metadata);
        const displayName = parseDisplayName(local.metadata, local.identity);
        
        setParticipant(local.identity, (ex) => ({ 
          ...ex, 
          displayName,
          role,
          isRecorder: false
        }));
        
        local.trackPublications.forEach((pub) => {
          try {
            if (pub.track) {
              if (pub.kind === Track.Kind.Video) {
                setParticipant(local.identity, (ex) => ({ ...ex, videoTrack: pub.track }));
              } else if (pub.kind === Track.Kind.Audio) {
                setParticipant(local.identity, (ex) => ({ ...ex, audioTrack: pub.track }));
                attachAudioAnalyser(local.identity, pub.track);
              }
            }
          } catch (e) { /* ignore */ }
        });
      }
      
      room.remoteParticipants.forEach((p) => {
        if (!isRecorderParticipant(p)) {
          addOrUpdateParticipant(p);
          p.trackPublications.forEach((pub) => {
            try {
              if (pub.isSubscribed && pub.track) {
                if (pub.kind === Track.Kind.Video) {
                  setParticipant(p.identity, (ex) => ({ ...ex, videoTrack: pub.track }));
                } else if (pub.kind === Track.Kind.Audio) {
                  setParticipant(p.identity, (ex) => ({ ...ex, audioTrack: pub.track }));
                  attachAudioAnalyser(p.identity, pub.track);
                }
              }
            } catch (e) { /* ignore */ }
          });
        }
      });
    } catch (e) {
      console.warn("DIAG_HYDRATION_FAILED", e);
    }

    // Wire events
    room.on("participantConnected", onParticipantConnected);
    room.on("participantDisconnected", onParticipantDisconnected);
    room.on("trackSubscribed", onTrackSubscribed);
    room.on("trackUnsubscribed", onTrackUnsubscribed);

    // Recording start logic - KEEP UNCHANGED
    const FRAME_DECODE_TIMEOUT = 5000;
    const startTime = Date.now();

    const tick = async () => {
      let shouldStart = false;
      let hasVideo = false;
      let hasSubscribed = false;
      let hasDecoded = false;

      try {
        for (const [, p] of room.remoteParticipants) {
          if (isRecorderParticipant(p)) continue;
          
          for (const [, pub] of p.trackPublications) {
            if (pub.isSubscribed) hasSubscribed = true;
            if (pub.kind === Track.Kind.Video) {
              hasVideo = true;
              if (pub.videoTrack) {
                try {
                  const stats = await pub.videoTrack.getRTCStatsReport();
                  if (stats && Array.from(stats).some((it) => it[1].type === "inbound-rtp" && (it[1].framesDecoded ?? 0) > 0)) {
                    hasDecoded = true;
                  }
                } catch (e) { /* ignore */ }
              }
            }
          }
        }
      } catch (e) {
        console.warn("DIAG_TICK_STATS_ERR", e);
      }

      const dt = Date.now() - startTime;
      if (hasDecoded) shouldStart = true;
      else if (!hasVideo && hasSubscribed && dt > 500) shouldStart = true;
      else if (dt > FRAME_DECODE_TIMEOUT && hasSubscribed) shouldStart = true;

      if (shouldStart && !startedRef.current) {
        startedRef.current = true;
        console.log("START_RECORDING");
        try { EgressHelper.startRecording(); } catch (e) { console.warn("DIAG_startRecording_failed", e); }
      } else if (!startedRef.current) {
        setTimeout(tick, 100);
      }
    };
    tick();

    // Periodic snapshot
    snapshotTimerRef.current = setInterval(() => {
      try {
        const snap = [];
        participants.forEach((p, id) => {
          if (!p.isRecorder) {
            snap.push({
              identity: id,
              displayName: p.displayName,
              role: p.role,
              hasVideoTrack: !!p.videoTrack,
              hasAudioTrack: !!p.audioTrack,
            });
          }
        });
        console.log("DIAG_SNAPSHOT", JSON.stringify({ time: new Date().toISOString(), snapshot: snap }));
      } catch (e) {
        console.warn("DIAG_SNAPSHOT_ERR", e);
      }
    }, 4000);

    // Enhanced audio level detection
    speakingTimerRef.current = setInterval(() => {
      try {
        setParticipants((prev) => {
          const next = new Map(prev);
          let changed = false;
          const now = Date.now();
          
          next.forEach((p, id) => {
            if (p.isRecorder) return;
            
            const entry = analyserMapRef.current.get(id);
            let speaking = false;
            let audioLevel = 0;
            
            if (entry?.analyser) {
              const buf = new Uint8Array(entry.analyser.frequencyBinCount);
              entry.analyser.getByteFrequencyData(buf);
              const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
              audioLevel = Math.min(100, Math.max(0, (avg / 128) * 100));
              speaking = avg > 25;
            }
            
            const lastSpokeAt = speaking ? now : p.lastSpokeAt;
            
            if (p.speaking !== speaking || Math.abs(p.audioLevel - audioLevel) > 5 || p.lastSpokeAt !== lastSpokeAt) {
              changed = true;
              next.set(id, { ...p, speaking, audioLevel, lastSpokeAt });
            }
          });
          return changed ? next : prev;
        });
      } catch (e) { /* ignore */ }
    }, 150);

    // Cleanup
    return () => {
      try { room.off("participantConnected", onParticipantConnected); } catch {}
      try { room.off("participantDisconnected", onParticipantDisconnected); } catch {}
      try { room.off("trackSubscribed", onTrackSubscribed); } catch {}
      try { room.off("trackUnsubscribed", onTrackUnsubscribed); } catch {}
      if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
      if (speakingTimerRef.current) clearInterval(speakingTimerRef.current);
      analyserMapRef.current.forEach((v) => { try { v?.ctx?.close?.(); } catch {} });
      analyserMapRef.current.clear();
    };
  }, [room, setParticipant, removeParticipant, showNotification]);

  // Filter and categorize participants based on roles
  const allParticipants = Array.from(participants.values()).filter(p => !p.isRecorder);
  
  // FEATURE 2: Filter coHost videos only for the video section
  const coHostVideoParticipants = allParticipants.filter(p => p.role === "coHost" && p.videoTrack);
  
  // Get other participants (excluding coHost videos) for the small list
  const otherParticipants = allParticipants.filter(p => !coHostVideoParticipants.includes(p));
  
  // Sort other participants by speaking status and recent activity
  const sortedOthers = otherParticipants.sort((a, b) => {
    if (a.speaking !== b.speaking) return b.speaking - a.speaking;
    return (b.lastSpokeAt || 0) - (a.lastSpokeAt || 0);
  });
  
  // Show max 5 participants in small list
  const displayedOthers = sortedOthers.slice(0, 5);
  const remainingCount = sortedOthers.length - displayedOthers.length;
  
  // Determine main stage participant using role-based priority
  const determineMainStageParticipant = () => {
    const hostWithVideo = allParticipants.find(p => p.role === "host" && p.videoTrack && p.audioTrack);
    if (hostWithVideo) return hostWithVideo;
    
    const hostWithVideoOnly = allParticipants.find(p => p.role === "host" && p.videoTrack);
    if (hostWithVideoOnly) return hostWithVideoOnly;
    
    const hostWithAudio = allParticipants.find(p => p.role === "host" && p.audioTrack);
    if (hostWithAudio) return hostWithAudio;
    
    const cohostWithVideo = allParticipants.find(p => p.role === "coHost" && p.videoTrack && p.audioTrack);
    if (cohostWithVideo) return cohostWithVideo;
    
    const cohostWithVideoOnly = allParticipants.find(p => p.role === "coHost" && p.videoTrack);
    if (cohostWithVideoOnly) return cohostWithVideoOnly;
    
    const cohostWithAudio = allParticipants.find(p => p.role === "coHost" && p.audioTrack);
    if (cohostWithAudio) return cohostWithAudio;
    
    const anyHost = allParticipants.find(p => p.role === "host");
    if (anyHost) return anyHost;
    
    const anyCohost = allParticipants.find(p => p.role === "coHost");
    if (anyCohost) return anyCohost;
    
    const firstWithVideo = allParticipants.find(p => p.videoTrack);
    if (firstWithVideo) return firstWithVideo;
    
    const firstWithAudio = allParticipants.find(p => p.audioTrack);
    if (firstWithAudio) return firstWithAudio;
    
    return allParticipants.length > 0 ? allParticipants[0] : null;
  };

  const mainStageParticipant = determineMainStageParticipant();
  
  const videoParticipants = otherParticipants.filter(p => p.videoTrack);
  const audioOnlyParticipants = otherParticipants.filter(p => !p.videoTrack && p.audioTrack);
  const silentParticipants = otherParticipants.filter(p => !p.videoTrack && !p.audioTrack);

  return (
    <>
      <div className="recording-container">
        {/* Header */}
        <div className="recording-header">
          <div className="recording-title">
            <div className="recording-indicator"></div>
            <span>Live Recording Session</span>
          </div>
          <div className="participant-count">
            {allParticipants.length} participant{allParticipants.length !== 1 ? 's' : ''}
            {mainStageParticipant && ` • Main: ${mainStageParticipant.displayName} (${mainStageParticipant.role})`}
          </div>
        </div>

        {/* Updated Main Layout */}
        <div className="main-layout">
          {/* Left Panel (20%) - Updated with coHost filter and small participant list */}
          <div className="left-panel">
            {/* Top: coHost Videos Only */}
            <div className="other-participants-section">
              <div className="other-participants-header">
                <span>coHost Videos</span>
                <span className="other-participants-count">{coHostVideoParticipants.length}</span>
              </div>
              
              <div className="other-participants-content">
                {/* Show only coHost video participants */}
                {coHostVideoParticipants.length > 0 && (
                  <div className="video-section">
                    <div className="video-tiles-grid">
                      {coHostVideoParticipants.map((p) => (
                        <ParticipantVideoTile key={p.identity} participant={p} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty state for coHost videos */}
                {coHostVideoParticipants.length === 0 && (
                  <div className="empty-other-participants">
                    <div className="empty-icon">📹</div>
                    <div className="empty-text">No coHost videos</div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom: Small Participant List (max 5) */}
            <div className="all-participants-section">
              <div className="all-participants-header">
                <span>Other Participants</span>
                <span className="all-participants-count">{displayedOthers.length}{remainingCount > 0 ? `+${remainingCount}` : ''}</span>
              </div>
              <div className="all-participants-content">
                <div className="small-participant-list">
                  {displayedOthers.map((participant) => (
                    <div 
                      key={participant.identity} 
                      className={`small-participant-item ${participant.speaking ? 'speaking' : ''}`}
                      title={participant.displayName}
                    >
                      <div className={`small-participant-avatar ${participant.role}`}>
                        {participant.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div className="small-participant-name">
                        {participant.displayName}
                      </div>
                      {participant.speaking && (
                        <div className="small-participant-speaking">🔊</div>
                      )}
                    </div>
                  ))}
                  
                  {/* Show "+N more" if there are remaining participants */}
                  {remainingCount > 0 && (
                    <div className="more-participants-placeholder">
                      +{remainingCount} more
                    </div>
                  )}
                </div>

                {displayedOthers.length === 0 && (
                  <div className="all-participants-empty">
                    <div className="empty-icon">👥</div>
                    <div className="empty-text">No other participants</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Main Stage Section (80%) - Full video coverage - UNCHANGED */}
          <div className={`main-stage ${mainStageParticipant?.speaking ? 'speaking' : ''}`}>
            {mainStageParticipant ? (
              <MainStageTile participant={mainStageParticipant} />
            ) : (
              <div className="no-main-stage">
                <div className="no-main-stage-content">
                  <div className="no-main-stage-icon">🎥</div>
                  <div className="no-main-stage-text">Waiting for participants...</div>
                  <div className="no-main-stage-subtitle">Recording will start automatically</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <RoomAudioRenderer />
        
        {/* Join/Leave Notifications - FIXED */}
        <NotificationToast notifications={notifications} />
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .recording-container {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          background: #0f172a;
          color: #f1f5f9;
          min-height: 100vh;
          padding: 16px;
          display: flex;
          flex-direction: column;
          position: relative;
        }

        .recording-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding: 14px 24px;
          background: rgba(15, 23, 42, 0.8);
          border-radius: 12px;
          backdrop-filter: blur(12px);
          border: 1px solid rgba(71, 85, 105, 0.2);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }

        .recording-title {
          display: flex;
          align-items: center;
          gap: 12px;
          font-weight: 600;
          font-size: 16px;
        }

        .recording-indicator {
          width: 12px;
          height: 12px;
          background: #ef4444;
          border-radius: 50%;
          animation: pulse-recording 2s infinite;
        }

        @keyframes pulse-recording {
          0%, 100% { 
            opacity: 1;
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
          }
          50% { 
            opacity: 0.8;
            transform: scale(1.1);
            box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
          }
        }

        .participant-count {
          font-size: 13px;
          color: #94a3b8;
          font-weight: 500;
        }

        /* Main Layout - 20% left, 80% right */
        .main-layout {
          display: flex;
          gap: 16px;
          flex: 1;
          min-height: 0;
        }

        /* Left Panel (20%) - Split into two vertical sections */
        .left-panel {
          flex: 0 0 20%;
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-height: 0;
        }

        /* Top Section: coHost Videos (60% of left panel) */
        .other-participants-section {
          flex: 0 0 60%;
          background: rgba(30, 41, 59, 0.4);
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid rgba(71, 85, 105, 0.2);
        }

        .other-participants-header {
          padding: 12px 16px;
          background: rgba(15, 23, 42, 0.6);
          border-bottom: 1px solid rgba(71, 85, 105, 0.2);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 600;
          font-size: 12px;
        }

        .other-participants-count {
          background: #475569;
          color: #e2e8f0;
          padding: 3px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
        }

        .other-participants-content {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
        }

        .other-participants-content::-webkit-scrollbar {
          width: 4px;
        }

        .other-participants-content::-webkit-scrollbar-track {
          background: rgba(71, 85, 105, 0.1);
          border-radius: 2px;
        }

        .other-participants-content::-webkit-scrollbar-thumb {
          background: rgba(71, 85, 105, 0.4);
          border-radius: 2px;
        }

        .video-section {
          margin-bottom: 16px;
        }

        .video-tiles-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 6px;
        }

        .empty-other-participants {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
          opacity: 0.5;
        }

        .empty-other-participants .empty-icon {
          font-size: 24px;
          margin-bottom: 8px;
        }

        .empty-other-participants .empty-text {
          font-size: 11px;
          color: #94a3b8;
          font-weight: 500;
        }

        /* Bottom Section: Small Participant List (40% of left panel) */
        .all-participants-section {
          flex: 0 0 38%;
          background: rgba(30, 41, 59, 0.4);
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid rgba(71, 85, 105, 0.2);
        }

        .all-participants-header {
          padding: 12px 16px;
          background: rgba(15, 23, 42, 0.6);
          border-bottom: 1px solid rgba(71, 85, 105, 0.2);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 600;
          font-size: 12px;
        }

        .all-participants-count {
          background: #22c55e;
          color: white;
          padding: 3px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
        }

        .all-participants-content {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .all-participants-content::-webkit-scrollbar {
          width: 4px;
        }

        .all-participants-content::-webkit-scrollbar-track {
          background: rgba(71, 85, 105, 0.1);
          border-radius: 2px;
        }

        .all-participants-content::-webkit-scrollbar-thumb {
          background: rgba(71, 85, 105, 0.4);
          border-radius: 2px;
        }

        /* Small Participant List Styles */
        .small-participant-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .small-participant-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          background: rgba(71, 85, 105, 0.15);
          border-radius: 6px;
          border: 1px solid transparent;
          transition: all 0.2s ease;
          position: relative;
        }

        .small-participant-item.speaking {
          background: rgba(34, 197, 94, 0.1);
          border-color: rgba(34, 197, 94, 0.3);
        }

        .small-participant-avatar {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 8px;
          font-weight: 600;
          color: white;
          flex-shrink: 0;
        }

        .small-participant-avatar.host {
          background: linear-gradient(135deg, #ef4444, #dc2626);
        }

        .small-participant-avatar.coHost {
          background: linear-gradient(135deg, #0ea5e9, #2563eb);
        }

        .small-participant-avatar.participant {
          background: linear-gradient(135deg, #64748b, #475569);
        }

        .small-participant-name {
          flex: 1;
          font-size: 10px;
          font-weight: 600;
          color: #f1f5f9;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
        }

        .small-participant-speaking {
          font-size: 8px;
          color: #22c55e;
        }

        .more-participants-placeholder {
          padding: 6px 8px;
          text-align: center;
          font-size: 10px;
          color: #94a3b8;
          font-weight: 600;
          background: rgba(71, 85, 105, 0.1);
          border-radius: 6px;
          margin-top: 4px;
        }

        .all-participants-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
          opacity: 0.5;
        }

        .all-participants-empty .empty-icon {
          font-size: 20px;
          margin-bottom: 8px;
        }

        .all-participants-empty .empty-text {
          font-size: 10px;
          color: #94a3b8;
          font-weight: 500;
        }

        /* Main Stage Section (80%) - UNCHANGED */
        .main-stage {
          flex: 0 0 78%;
          background: #000;
          border-radius: 16px;
          overflow: hidden;
          position: relative;
          min-height: 450px;
          border: 3px solid transparent;
          transition: all 0.3s ease;
          box-shadow: 0 8px 25px -5px rgba(0, 0, 0, 0.1);
        }

        .main-stage.speaking {
          border-color: #22c55e;
          box-shadow: 
            0 0 0 4px rgba(34, 197, 94, 0.15),
            0 8px 25px -5px rgba(0, 0, 0, 0.1);
        }

        .no-main-stage {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          background: linear-gradient(135deg, #1e293b, #334155);
        }

        .no-main-stage-content {
          text-align: center;
          opacity: 0.7;
        }

        .no-main-stage-icon {
          font-size: 64px;
          margin-bottom: 20px;
        }

        .no-main-stage-text {
          font-size: 20px;
          font-weight: 600;
          color: #f1f5f9;
          margin-bottom: 8px;
        }

        .no-main-stage-subtitle {
          font-size: 14px;
          color: #94a3b8;
          font-weight: 500;
        }

        /* Main Stage Tile - Full Coverage - UNCHANGED */
        .main-stage-tile {
          width: 100%;
          height: 100%;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
          overflow: hidden;
        }

        .main-stage-tile video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
        }

        .main-stage-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: 40px;
          text-align: center;
        }

        .main-stage-avatar {
          width: 140px;
          height: 140px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 48px;
          font-weight: 700;
          color: white;
          margin-bottom: 28px;
          position: relative;
        }

        .main-stage-avatar.speaking {
          animation: pulse-avatar 1.2s infinite;
        }

        .main-stage-avatar.host {
          background: linear-gradient(135deg, #ef4444, #dc2626);
        }

        .main-stage-avatar.coHost {
          background: linear-gradient(135deg, #0ea5e9, #2563eb);
        }

        @keyframes pulse-avatar {
          0%, 100% { 
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.8);
          }
          50% { 
            transform: scale(1.08);
            box-shadow: 0 0 0 25px rgba(34, 197, 94, 0);
          }
        }

        .main-stage-name {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 10px;
          color: #f1f5f9;
        }

        .main-stage-status {
          font-size: 16px;
          color: #94a3b8;
          font-weight: 500;
        }

        .main-stage-status.audio-only {
          color: #22c55e;
        }

        .main-stage-label {
          position: absolute;
          bottom: 20px;
          left: 20px;
          right: 20px;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(12px);
          padding: 16px 20px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .main-stage-name-overlay {
          font-size: 18px;
          font-weight: 600;
          color: white;
          flex: 1;
          margin-right: 16px;
        }

        .role-badge {
          color: white;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-right: 16px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .role-badge.host {
          background: linear-gradient(135deg, #ef4444, #dc2626);
        }

        .role-badge.coHost {
          background: linear-gradient(135deg, #0ea5e9, #2563eb);
        }

        .role-badge.participant {
          background: linear-gradient(135deg, #475569, #64748b);
        }

        /* Participant video tiles - UNCHANGED */
        .participant-video-tile {
          aspect-ratio: 16/9;
          background: #000;
          border-radius: 8px;
          overflow: hidden;
          position: relative;
          border: 2px solid transparent;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .participant-video-tile.speaking {
          border-color: #22c55e;
          box-shadow: 
            0 0 0 2px rgba(34, 197, 94, 0.3),
            0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .participant-video-tile video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .participant-video-label {
          position: absolute;
          bottom: 6px;
          left: 6px;
          right: 6px;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(8px);
          padding: 4px 8px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .participant-video-name {
          font-size: 10px;
          font-weight: 600;
          color: white;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
          flex: 1;
        }

        .participant-role-badge {
          font-size: 8px;
          font-weight: 600;
          padding: 2px 4px;
          border-radius: 3px;
          margin-left: 4px;
        }

        .participant-role-badge.host {
          background: #ef4444;
          color: white;
        }

        .participant-role-badge.coHost {
          background: #0ea5e9;
          color: white;
        }

        .participant-role-badge.participant {
          background: #475569;
          color: #e2e8f0;
        }

        /* Audio indicators - UNCHANGED */
        .audio-indicator {
          display: flex;
          align-items: end;
          gap: 1px;
          flex-shrink: 0;
        }

        .audio-indicator-large {
          width: 28px;
          height: 18px;
          gap: 2px;
        }

        .audio-indicator-small {
          width: 16px;
          height: 10px;
          gap: 1px;
        }

        .audio-bar {
          background: #22c55e;
          border-radius: 1px;
          transition: height 0.1s ease-out;
        }

        .audio-indicator-large .audio-bar {
          width: 3px;
        }

        .audio-indicator-small .audio-bar {
          width: 2px;
        }

        .audio-indicator-large .audio-bar:nth-child(1) { height: 4px; }
        .audio-indicator-large .audio-bar:nth-child(2) { height: 6px; }
        .audio-indicator-large .audio-bar:nth-child(3) { height: 8px; }
        .audio-indicator-large .audio-bar:nth-child(4) { height: 10px; }
        .audio-indicator-large .audio-bar:nth-child(5) { height: 14px; }

        .audio-indicator-small .audio-bar:nth-child(1) { height: 2px; }
        .audio-indicator-small .audio-bar:nth-child(2) { height: 4px; }
        .audio-indicator-small .audio-bar:nth-child(3) { height: 6px; }
        .audio-indicator-small .audio-bar:nth-child(4) { height: 8px; }

        .audio-indicator.speaking .audio-bar {
          animation: audio-bars 0.4s infinite ease-in-out;
        }

        .audio-indicator.speaking .audio-bar:nth-child(1) { animation-delay: 0s; }
        .audio-indicator.speaking .audio-bar:nth-child(2) { animation-delay: 0.1s; }
        .audio-indicator.speaking .audio-bar:nth-child(3) { animation-delay: 0.2s; }
        .audio-indicator.speaking .audio-bar:nth-child(4) { animation-delay: 0.3s; }
        .audio-indicator.speaking .audio-bar:nth-child(5) { animation-delay: 0.4s; }

        @keyframes audio-bars {
          0%, 100% { 
            transform: scaleY(0.3);
            opacity: 0.6;
          }
          50% { 
            transform: scaleY(1.2);
            opacity: 1;
          }
        }

        .audio-indicator:not(.speaking) .audio-bar {
          opacity: 0.3;
          transform: scaleY(0.3);
        }

        /* Notification System - FIXED */
        .notification-container {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 1000;
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-width: 350px;
          pointer-events: none;
        }

        .notification {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
          background: rgba(30, 41, 59, 0.95);
          border: 1px solid rgba(71, 85, 105, 0.3);
          border-radius: 12px;
          backdrop-filter: blur(12px);
          box-shadow: 0 8px 25px -5px rgba(0, 0, 0, 0.2);
          transform: translateX(100%);
          opacity: 0;
          transition: all 0.3s ease;
          pointer-events: auto;
        }

        .notification.show {
          transform: translateX(0);
          opacity: 1;
        }

        .notification.hide {
          transform: translateX(100%);
          opacity: 0;
        }

        .notification.join {
          border-left: 4px solid #22c55e;
        }

        .notification.leave {
          border-left: 4px solid #ef4444;
        }

        .notification-icon {
          font-size: 24px;
          flex-shrink: 0;
        }

        .notification-content {
          flex: 1;
        }

        .notification-title {
          font-size: 14px;
          font-weight: 600;
          color: #f1f5f9;
          margin-bottom: 4px;
        }

        .notification-message {
          font-size: 12px;
          color: #94a3b8;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .role-indicator {
          font-size: 9px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .role-indicator.host {
          background: #ef4444;
          color: white;
        }

        .role-indicator.coHost {
          background: #0ea5e9;
          color: white;
        }

        .role-indicator.participant {
          background: #64748b;
          color: white;
        }

        /* Responsive Design - UNCHANGED */
        @media (max-width: 1200px) {
          .main-layout {
            flex-direction: column;
          }
          
          .left-panel {
            flex: none;
            flex-direction: row;
            height: 200px;
          }
          
          .other-participants-section {
            flex: 0 0 60%;
          }
          
          .all-participants-section {
            flex: 0 0 38%;
          }
          
          .main-stage {
            flex: none;
            height: 60vh;
            min-height: 400px;
          }

          .video-tiles-grid {
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 4px;
          }
        }

        @media (max-width: 768px) {
          .recording-container {
            padding: 12px;
          }
          
          .recording-header {
            flex-direction: column;
            gap: 8px;
            text-align: center;
            padding: 12px 16px;
          }
          
          .left-panel {
            height: 150px;
          }
          
          .main-stage {
            height: 50vh;
            min-height: 300px;
          }
          
          .other-participants-content {
            padding: 8px;
          }
          
          .all-participants-content {
            padding: 6px;
          }

          .main-stage-avatar {
            width: 80px;
            height: 80px;
            font-size: 28px;
          }
          
          .main-stage-name {
            font-size: 20px;
          }
          
          .main-layout {
            gap: 12px;
          }

          .notification-container {
            right: 12px;
            top: 12px;
            max-width: 280px;
          }

          .notification {
            padding: 12px 16px;
          }
        }
      `}</style>
    </>
  );
}

// Audio indicator component - UNCHANGED
function AudioIndicator({ speaking, audioLevel, size = "small" }) {
  const barCount = size === "large" ? 5 : 4;
  
  return (
    <div className={`audio-indicator audio-indicator-${size} ${speaking ? 'speaking' : ''}`}>
      {Array.from({ length: barCount }).map((_, i) => (
        <div 
          key={i} 
          className="audio-bar"
          style={{
            height: speaking ? `${Math.max(2, (audioLevel / 100) * (size === "large" ? 14 : 8))}px` : undefined
          }}
        />
      ))}
    </div>
  );
}

// Main stage tile component - UNCHANGED
function MainStageTile({ participant }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    if (participant.videoTrack && participant.videoTrack.mediaStreamTrack) {
      try {
        v.srcObject = new MediaStream([participant.videoTrack.mediaStreamTrack]);
        v.muted = true;
        const playPromise = v.play();
        if (playPromise && playPromise.then) {
          playPromise.catch((e) => { /* autoplay blocked */ });
        }
      } catch (e) {
        console.warn("DIAG_MAIN_STAGE_VIDEO_ATTACH_ERR", participant.identity, e);
      }
    } else {
      try {
        if (v.srcObject) v.srcObject = null;
      } catch (e) { /* ignore */ }
    }

    return () => {
      try {
        if (v) v.srcObject = null;
      } catch (e) { /* ignore */ }
    };
  }, [participant.videoTrack]);

  const getInitials = (name) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleBadgeText = (role) => {
    if (role === "coHost") return "coHost";
    return role.toUpperCase();
  };

  return (
    <div className={`main-stage-tile ${participant.speaking ? 'speaking' : ''}`}>
      {participant.videoTrack ? (
        <>
          <video ref={videoRef} playsInline autoPlay />
          <div className="main-stage-label">
            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div className={`role-badge ${participant.role}`}>{getRoleBadgeText(participant.role)}</div>
              <span className="main-stage-name-overlay">{participant.displayName}</span>
            </div>
            {participant.audioTrack && (
              <AudioIndicator 
                speaking={participant.speaking} 
                audioLevel={participant.audioLevel || 0} 
                size="large"
              />
            )}
          </div>
        </>
      ) : (
        <div className="main-stage-placeholder">
          <div className={`main-stage-avatar ${participant.role} ${participant.speaking ? 'speaking' : ''}`}>
            {getInitials(participant.displayName)}
          </div>
          <div className="main-stage-name">
            {participant.displayName}
            <span className={`role-badge ${participant.role}`} style={{ marginLeft: '12px', fontSize: '12px' }}>
              {getRoleBadgeText(participant.role)}
            </span>
          </div>
          <div className={`main-stage-status ${participant.audioTrack ? 'audio-only' : ''}`}>
            {participant.audioTrack ? 'Audio only' : 'Not connected'}
          </div>
          {participant.audioTrack && (
            <div style={{ marginTop: '20px' }}>
              <AudioIndicator 
                speaking={participant.speaking} 
                audioLevel={participant.audioLevel || 0} 
                size="large"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Participant video tile component - UNCHANGED
function ParticipantVideoTile({ participant }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    if (participant.videoTrack && participant.videoTrack.mediaStreamTrack) {
      try {
        v.srcObject = new MediaStream([participant.videoTrack.mediaStreamTrack]);
        v.muted = true;
        const playPromise = v.play();
        if (playPromise && playPromise.then) {
          playPromise.catch((e) => { /* autoplay blocked */ });
        }
      } catch (e) {
        console.warn("DIAG_PARTICIPANT_VIDEO_ATTACH_ERR", participant.identity, e);
      }
    } else {
      try {
        if (v.srcObject) v.srcObject = null;
      } catch (e) { /* ignore */ }
    }

    return () => {
      try {
        if (v) v.srcObject = null;
      } catch (e) { /* ignore */ }
    };
  }, [participant.videoTrack]);

  return (
    <div className={`participant-video-tile ${participant.speaking ? 'speaking' : ''}`}>
      <video ref={videoRef} playsInline autoPlay />
      <div className="participant-video-label">
        <span className="participant-video-name">
          {participant.displayName}
          <span className={`participant-role-badge ${participant.role}`}>
            {participant.role === "coHost" ? "CO" : participant.role.charAt(0).toUpperCase()}
          </span>
        </span>
        {participant.audioTrack && (
          <AudioIndicator 
            speaking={participant.speaking} 
            audioLevel={participant.audioLevel || 0} 
            size="small"
          />
        )}
      </div>
    </div>
  );
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const wsUrl = params.get("url") || params.get("wsUrl");
  const token = params.get("token") || params.get("accessToken");

  if (!wsUrl || !token) {
    return (
      <div className="error-container">
        <div className="error-content">
          <h2>⚠️ Configuration Required</h2>
          <p>This recording template needs URL parameters:</p>
          <code>?url=&lt;websocket-url&gt;&token=&lt;access-token&gt;</code>
          <div className="error-details">
            <p>Make sure your LiveKit server URL and access token are provided correctly.</p>
          </div>
        </div>
        <style>{`
          .error-container {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #0f172a, #1e293b);
            font-family: 'Inter', sans-serif;
            padding: 24px;
          }
          .error-content {
            text-align: center;
            max-width: 500px;
            background: rgba(30, 41, 59, 0.8);
            padding: 40px;
            border-radius: 16px;
            border: 1px solid rgba(71, 85, 105, 0.3);
          }
          .error-content h2 {
            color: #f1f5f9;
            margin-bottom: 16px;
            font-size: 24px;
            font-weight: 600;
          }
          .error-content p {
            color: #cbd5e1;
            margin-bottom: 20px;
            line-height: 1.6;
          }
          .error-content code {
            background: #1e293b;
            padding: 12px 16px;
            border-radius: 8px;
            font-family: 'Monaco', monospace;
            color: #22c55e;
            display: block;
            margin: 20px 0;
            font-size: 13px;
          }
          .error-details {
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px solid rgba(71, 85, 105, 0.3);
          }
          .error-details p {
            font-size: 14px;
            color: #94a3b8;
          }
        `}</style>
      </div>
    );
  }

  return (
    <LiveKitRoom serverUrl={wsUrl} token={token} connectOptions={{ autoSubscribe: true }}>
      <TemplateInner />
    </LiveKitRoom>
  );
}
