// src/App.jsx - Fixed version with better debugging

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  LiveKitRoom,
  useRoomContext,
  RoomAudioRenderer,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import EgressHelper from "@livekit/egress-sdk";

// Parse a display name from metadata or fallback to identity
function parseDisplayName(metadata, identity) {
  if (!metadata) return identity;
  try {
    const parsed = JSON.parse(metadata);
    if (parsed?.displayName) return parsed.displayName;
    if (parsed?.name) return parsed.name;
    if (parsed?.username) return parsed.username;
  } catch {}
  if (typeof metadata === "string" && metadata.length < 64) return metadata;
  return identity;
}

// Extract role from metadata JSON
function parseRole(metadata) {
  if (!metadata) return "participant";
  try {
    const parsed = JSON.parse(metadata);
    const role = parsed?.role;
    if (role === "host" || role === "coHost" || role === "participant") {
      return role;
    }
    return "participant";
  } catch {
    return "participant";
  }
}

// Determine role using attributes first, then metadata
function getParticipantRole(participant) {
  if (participant.attributes?.role) {
    const role = participant.attributes.role;
    if (role === "host" || role === "coHost" || role === "participant") {
      return role;
    }
  }
  return parseRole(participant.metadata);
}

// FIXED: More restrictive egress detection
function isRecorderParticipant(participant) {
  if (participant.kind === "egress") return true;
  
  const id = participant.identity?.toLowerCase() || "";
  const md = participant.metadata?.toLowerCase() || "";
  
  // More specific checks to avoid false positives
  const isEgressByName = (
    id.includes("egress-") || 
    id.includes("recorder-") || 
    id.includes("recording-") ||
    id.startsWith("egress_") ||
    id.startsWith("recorder_")
  );
  
  const isEgressByMetadata = (
    md.includes('"egress"') || 
    md.includes('"recorder"') ||
    md.includes("egress-service") ||
    md.includes("recording-service")
  );
  
  console.log("DIAG_EGRESS_CHECK", {
    identity: participant.identity,
    kind: participant.kind,
    isEgressByName,
    isEgressByMetadata,
    metadata: participant.metadata
  });
  
  return isEgressByName || isEgressByMetadata;
}

// Hook to manage participants state
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
        joinedAt: Date.now(),
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

// Join/Leave notification toasts
function NotificationToast({ notifications }) {
  if (!notifications.length) return null;
  return (
    <div className="notification-container">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`notification ${n.type} ${n.isVisible ? "show" : "hide"}`}
        >
          <div className="notification-icon">👋</div>
          <div className="notification-content">
            <div className="notification-title">
              {n.type === "join" ? "Participant Joined" : "Participant Left"}
            </div>
            <div className="notification-message">
              <span className={`role-indicator ${n.role}`}>
                {n.role === "coHost" ? "coHost" : n.role.toUpperCase()}
              </span>{" "}
              {n.displayName}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateInner() {
  const room = useRoomContext();
  const { participants, setParticipant, removeParticipant, setParticipants } =
    useParticipants(room);
  const startedRef = useRef(false);
  const snapshotTimerRef = useRef();
  const speakingTimerRef = useRef();
  const analyserMapRef = useRef(new Map());
  const [notifications, setNotifications] = useState([]);

  // Show join/leave toasts
  const showNotification = useCallback((type, displayName, role) => {
    const id = Date.now() + Math.random();
    const notif = { id, type, displayName, role, isVisible: false };
    setNotifications((prev) => [...prev, notif]);
    setTimeout(() => setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isVisible: true } : n))
    ), 100);
    setTimeout(() => setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isVisible: false } : n))
    ), 4000);
    setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 4500);
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
      remoteIdentities: Array.from(room.remoteParticipants.keys())
    });

    // FIXED: Add or update participant - with better logging
    const addOrUpdate = (p) => {
      const role = getParticipantRole(p);
      const displayName = p.name || p.identity;
      const isRecorder = isRecorderParticipant(p);
      
      console.log("DIAG_ADD_OR_UPDATE", {
        identity: p.identity,
        name: p.name,
        displayName,
        role,
        isRecorder,
        kind: p.kind,
        metadata: p.metadata,
        trackCount: p.trackPublications?.size || 0
      });
      
      if (isRecorder) {
        console.log("DIAG_SKIPPING_RECORDER", { identity: p.identity });
        return;
      }
      
      // ALWAYS add participant regardless of tracks
      setParticipant(p.identity, (ex) => ({
        ...ex,
        displayName,
        role,
        isRecorder: false,
        joinedAt: ex.joinedAt || Date.now(),
        speaking: p.isSpeaking || false,
      }));
      
      console.log("DIAG_PARTICIPANT_ADDED", {
        identity: p.identity,
        role,
        displayName,
        hasVideo: !!p.videoTrack,
        hasAudio: !!p.audioTrack,
      });
    };

    // Connected/disconnected handlers
    const onConnect = (p) => {
      console.log("DIAG_PARTICIPANT_CONNECTED", { identity: p.identity });
      if (isRecorderParticipant(p)) return;
      addOrUpdate(p);
      showNotification("join", p.name || p.identity, getParticipantRole(p));
    };
    
    const onDisconnect = (p) => {
      console.log("DIAG_PARTICIPANT_DISCONNECTED", { identity: p.identity });
      if (!isRecorderParticipant(p)) {
        showNotification("leave", p.name || p.identity, getParticipantRole(p));
      }
      const old = analyserMapRef.current.get(p.identity);
      old?.ctx?.close?.();
      analyserMapRef.current.delete(p.identity);
      removeParticipant(p.identity);
    };

    // Audio analyser
    const attachAudioAnalyser = (id, track) => {
      if (track.kind !== "audio") return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const ms = new MediaStream([track.mediaStreamTrack]);
      const src = ctx.createMediaStreamSource(ms);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      src.connect(analyser);
      analyserMapRef.current.get(id)?.ctx?.close?.();
      analyserMapRef.current.set(id, { ctx, analyser });
    };

    // Track events
    const onTrackSub = (track, pub, p) => {
      console.log("DIAG_TRACK_SUBSCRIBED", {
        participant: p.identity,
        kind: track.kind,
        trackSid: pub.trackSid
      });
      
      if (isRecorderParticipant(p)) return;
      const role = getParticipantRole(p);
      
      // Always ensure participant exists first
      addOrUpdate(p);
      
      if (track.kind === Track.Kind.Video) {
        setParticipant(p.identity, (ex) => ({ ...ex, videoTrack: track, role }));
      } else if (track.kind === Track.Kind.Audio) {
        setParticipant(p.identity, (ex) => ({ ...ex, audioTrack: track, role }));
        attachAudioAnalyser(p.identity, track);
      }
    };
    
    const onTrackUnsub = (_track, pub, p) => {
      const id = p.identity;
      if (pub.kind === Track.Kind.Video) {
        setParticipant(id, (ex) => ({ ...ex, videoTrack: null }));
      } else {
        setParticipant(id, (ex) => ({ ...ex, audioTrack: null }));
        analyserMapRef.current.get(id)?.ctx?.close?.();
        analyserMapRef.current.delete(id);
      }
    };

    // FIXED: Better hydration with debugging
    try {
      const local = room.localParticipant;
      if (local && !isRecorderParticipant(local)) {
        console.log("DIAG_HYDRATING_LOCAL", { identity: local.identity, name: local.name });
        setParticipant(local.identity, (ex) => ({
          ...ex,
          displayName: local.name || local.identity,
          role: getParticipantRole(local),
          isRecorder: false,
        }));
        
        local.trackPublications.forEach((pub) => {
          if (pub.track) {
            if (pub.kind === Track.Kind.Video) {
              setParticipant(local.identity, (ex) => ({ ...ex, videoTrack: pub.track }));
            } else {
              setParticipant(local.identity, (ex) => ({ ...ex, audioTrack: pub.track }));
              attachAudioAnalyser(local.identity, pub.track);
            }
          }
        });
      }
      
      // FIXED: Add ALL remote participants with better logging
      console.log("DIAG_HYDRATING_REMOTES", {
        count: room.remoteParticipants.size,
        identities: Array.from(room.remoteParticipants.keys())
      });
      
      room.remoteParticipants.forEach((p, identity) => {
        console.log("DIAG_PROCESSING_REMOTE", {
          identity,
          name: p.name,
          kind: p.kind,
          metadata: p.metadata,
          trackCount: p.trackPublications?.size
        });
        
        if (!isRecorderParticipant(p)) {
          addOrUpdate(p); // This will add them even without tracks
          
          // Then add their tracks if they have any
          p.trackPublications.forEach((pub) => {
            console.log("DIAG_HYDRATING_TRACK", {
              participant: identity,
              kind: pub.kind,
              subscribed: pub.subscribed,
              hasTrack: !!pub.track
            });
            
            if (pub.subscribed && pub.track) {
              if (pub.kind === Track.Kind.Video) {
                setParticipant(p.identity, (ex) => ({ ...ex, videoTrack: pub.track }));
              } else {
                setParticipant(p.identity, (ex) => ({ ...ex, audioTrack: pub.track }));
                attachAudioAnalyser(p.identity, pub.track);
              }
            }
          });
        } else {
          console.log("DIAG_SKIPPED_REMOTE_RECORDER", { identity });
        }
      });
    } catch (e) {
      console.warn("DIAG_HYDRATION_FAILED", e);
    }

    // Wire events
    room.on("participantConnected", onConnect);
    room.on("participantDisconnected", onDisconnect);
    room.on("trackSubscribed", onTrackSub);
    room.on("trackUnsubscribed", onTrackUnsub);

    // Recording logic (unchanged)
    const FRAME_TIMEOUT = 5000;
    const startAt = Date.now();
    const tick = async () => {
      let shouldStart = false, hasVideo = false, hasSub = false, hasDecoded = false;
      try {
        for (const p of room.remoteParticipants.values()) {
          if (isRecorderParticipant(p)) continue;
          for (const pub of p.trackPublications.values()) {
            if (pub.subscribed) hasSub = true;
            if (pub.kind === Track.Kind.Video) {
              hasVideo = true;
              if (pub.videoTrack) {
                const stats = await pub.videoTrack.getRTCStatsReport();
                if (Array.from(stats.values()).some((s) => s.type === "inbound-rtp" && (s.framesDecoded || 0) > 0)) {
                  hasDecoded = true;
                }
              }
            }
          }
        }
      } catch {}
      const dt = Date.now() - startAt;
      if (hasDecoded || (!hasVideo && hasSub && dt > 500) || (hasSub && dt > FRAME_TIMEOUT)) {
        shouldStart = true;
      }
      if (shouldStart && !startedRef.current) {
        startedRef.current = true;
        console.log("START_RECORDING");
        try {
          EgressHelper.startRecording();
        } catch (e) {
          console.warn("DIAG_startRecording_failed", e);
        }
      } else if (!startedRef.current) {
        setTimeout(tick, 100);
      }
    };
    tick();

    // Periodic snapshot
    snapshotTimerRef.current = setInterval(() => {
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
    }, 4000);

    // Audio level detection
    speakingTimerRef.current = setInterval(() => {
      setParticipants((prev) => {
        const next = new Map(prev);
        let changed = false;
        const now = Date.now();
        next.forEach((p, id) => {
          if (p.isRecorder) return;
          const entry = analyserMapRef.current.get(id);
          let audioLevel = 0, speaking = false;
          if (entry?.analyser) {
            const buf = new Uint8Array(entry.analyser.frequencyBinCount);
            entry.analyser.getByteFrequencyData(buf);
            const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
            audioLevel = Math.min(100, (avg / 128) * 100);
            speaking = avg > 25;
          }
          const lastSpoke = speaking ? now : p.lastSpokeAt;
          if (p.speaking !== speaking || Math.abs(p.audioLevel - audioLevel) > 5 || p.lastSpokeAt !== lastSpoke) {
            changed = true;
            next.set(id, { ...p, speaking, audioLevel, lastSpokeAt: lastSpoke });
          }
        });
        return changed ? next : prev;
      });
    }, 150);

    // Cleanup
    return () => {
      room.off("participantConnected", onConnect);
      room.off("participantDisconnected", onDisconnect);
      room.off("trackSubscribed", onTrackSub);
      room.off("trackUnsubscribed", onTrackUnsub);
      clearInterval(snapshotTimerRef.current);
      clearInterval(speakingTimerRef.current);
      analyserMapRef.current.forEach((v) => v.ctx?.close());
      analyserMapRef.current.clear();
    };
  }, [room, setParticipant, removeParticipant, setParticipants, showNotification]);

  // Filter participants by role - with debugging
  const allParticipants = Array.from(participants.values()).filter((p) => !p.isRecorder);
  
  console.log("DIAG_CURRENT_STATE", {
    participantMapSize: participants.size,
    allParticipants: allParticipants.length,
    allParticipantsList: allParticipants.map(p => ({ id: p.identity, role: p.role, name: p.displayName }))
  });
  
  // HOST participants for main stage (ONLY host role)
  const hostParticipants = allParticipants.filter((p) => p.role === "host");
  
  // coHost participants with video for coHost video section
  const coHostVideoParticipants = allParticipants.filter(
    (p) => p.role === "coHost" && p.videoTrack
  );
  
  // All other participants (not host or coHost) for participant list - REGARDLESS of media
  const otherParticipants = allParticipants.filter(
    (p) => p.role !== "host" && p.role !== "coHost"
  );
  
  // Sort other participants by speaking status and recent activity
  const sortedOthers = otherParticipants.sort((a, b) => {
    if (a.speaking !== b.speaking) return b.speaking - a.speaking;
    return (b.lastSpokeAt || 0) - (a.lastSpokeAt || 0);
  });
  
  // Show max 5 participants in small list
  const displayedOthers = sortedOthers.slice(0, 5);
  const remainingCount = sortedOthers.length - displayedOthers.length;

  // Determine main stage participant - ONLY HOST
  const determineMainStageParticipant = () => {
    const hostWithVideo = hostParticipants.find((p) => p.videoTrack && p.audioTrack);
    if (hostWithVideo) return hostWithVideo;
    
    const hostWithVideoOnly = hostParticipants.find((p) => p.videoTrack);
    if (hostWithVideoOnly) return hostWithVideoOnly;
    
    const hostWithAudio = hostParticipants.find((p) => p.audioTrack);
    if (hostWithAudio) return hostWithAudio;
    
    return hostParticipants[0] || null;
  };
  
  const mainStageParticipant = determineMainStageParticipant();

  console.log("DIAG_PARTICIPANT_FILTERING", {
    total: allParticipants.length,
    hosts: hostParticipants.length,
    coHostVideos: coHostVideoParticipants.length,
    others: otherParticipants.length,
    displayed: displayedOthers.length,
    mainStage: mainStageParticipant?.displayName,
  });

  return (
    <>
      <div className="recording-container">
        <div className="recording-header">
          <div className="recording-title">
            <div className="recording-indicator"></div>
            <span>Live Recording Session</span>
          </div>
          <div className="participant-count">
            {allParticipants.length} participant{allParticipants.length !== 1 ? "s" : ""}
            {mainStageParticipant && ` • Main: ${mainStageParticipant.displayName} (${mainStageParticipant.role})`}
          </div>
        </div>
        
        <div className="main-layout">
          {/* Left Panel - coHost Videos and Other Participants */}
          <div className="left-panel">
            {/* coHost Videos Section */}
            <div className="other-participants-section">
              <div className="other-participants-header">
                <span>coHost Videos</span>
                <span className="other-participants-count">{coHostVideoParticipants.length}</span>
              </div>
              <div className="other-participants-content">
                {coHostVideoParticipants.length > 0 ? (
                  <div className="video-section">
                    <div className="video-tiles-grid">
                      {coHostVideoParticipants.map((p) => (
                        <ParticipantVideoTile key={p.identity} participant={p} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="empty-other-participants">
                    <div className="empty-icon">📹</div>
                    <div className="empty-text">No coHost videos</div>
                  </div>
                )}
              </div>
            </div>
            {/* test */}
            
            {/* Other Participants List */}
            <div className="all-participants-section">
              <div className="all-participants-header">
                <span>Other Participants</span>
                <span className="all-participants-count">
                  {displayedOthers.length}
                  {remainingCount > 0 ? `+${remainingCount}` : ""}
                </span>
              </div>
              <div className="all-participants-content">
                <div className="small-participant-list">
                  {displayedOthers.map((p) => (
                    <div
                      key={p.identity}
                      className={`small-participant-item ${p.speaking ? "speaking" : ""}`}
                      title={p.displayName}
                    >
                      <div className={`small-participant-avatar ${p.role}`}>
                        {p.displayName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2)}
                      </div>
                      <div className="small-participant-name">{p.displayName}</div>
                      {p.speaking && <div className="small-participant-speaking">🔊</div>}
                      {!p.videoTrack && !p.audioTrack && (
                        <div className="small-participant-status">📱</div>
                      )}
                    </div>
                  ))}
                  {remainingCount > 0 && <div className="more-participants-placeholder">+{remainingCount} more</div>}
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
          
          {/* Main Stage - ONLY HOST */}
          <div className={`main-stage ${mainStageParticipant?.speaking ? "speaking" : ""}`}>
            {mainStageParticipant ? (
              <MainStageTile participant={mainStageParticipant} />
            ) : (
              <div className="no-main-stage">
                <div className="no-main-stage-content">
                  <div className="no-main-stage-icon">🎥</div>
                  <div className="no-main-stage-text">Waiting for host...</div>
                  <div className="no-main-stage-subtitle">Recording will start automatically</div>
                </div>
              </div>
            )}
          </div>
        </div>
        
        <RoomAudioRenderer />
        <NotificationToast notifications={notifications} />
      </div>
    </>
  );
}

// Audio level indicator (unchanged)
function AudioIndicator({ speaking, audioLevel, size = "small" }) {
  const bars = size === "large" ? 5 : 4;
  return (
    <div className={`audio-indicator audio-indicator-${size} ${speaking ? "speaking" : ""}`}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="audio-bar"
          style={{
            height: speaking ? `${Math.max(2, (audioLevel / 100) * (size === "large" ? 14 : 8))}px` : undefined,
          }}
        />
      ))}
    </div>
  );
}

// Main stage video tile (unchanged)
function MainStageTile({ participant }) {
  const videoRef = useRef();
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (participant.videoTrack?.mediaStreamTrack) {
      try {
        v.srcObject = new MediaStream([participant.videoTrack.mediaStreamTrack]);
        v.muted = true;
        const p = v.play();
        if (p?.then) p.catch(() => {});
      } catch {}
    } else {
      v.srcObject = null;
    }
    return () => { if (v) v.srcObject = null; };
  }, [participant.videoTrack]);
  
  const initials = participant.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const badge = participant.role === "coHost" ? "coHost" : participant.role.toUpperCase();
  
  return (
    <div className={`main-stage-tile ${participant.speaking ? "speaking" : ""}`}>
      {participant.videoTrack ? (
        <>
          <video ref={videoRef} playsInline autoPlay />
          <div className="main-stage-label">
            <div style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div className={`role-badge ${participant.role}`}>{badge}</div>
              <span className="main-stage-name-overlay">{participant.displayName}</span>
            </div>
            {participant.audioTrack && (
              <AudioIndicator speaking={participant.speaking} audioLevel={participant.audioLevel} size="large" />
            )}
          </div>
        </>
      ) : (
        <div className="main-stage-placeholder">
          <div className={`main-stage-avatar ${participant.role} ${participant.speaking ? "speaking" : ""}`}>
            {initials}
          </div>
          <div className="main-stage-name">
            {participant.displayName} <span className={`role-badge ${participant.role}`}>{badge}</span>
          </div>
          <div className={`main-stage-status ${participant.audioTrack ? "audio-only" : ""}`}>
            {participant.audioTrack ? "Audio only" : "Not connected"}
          </div>
          {participant.audioTrack && (
            <div style={{ marginTop: 20 }}>
              <AudioIndicator speaking={participant.speaking} audioLevel={participant.audioLevel} size="large" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Video tile for participant (unchanged)
function ParticipantVideoTile({ participant }) {
  const videoRef = useRef();
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (participant.videoTrack?.mediaStreamTrack) {
      try {
        v.srcObject = new MediaStream([participant.videoTrack.mediaStreamTrack]);
        v.muted = true;
        const p = v.play();
        if (p?.then) p.catch(() => {});
      } catch {}
    } else {
      v.srcObject = null;
    }
    return () => { if (v) v.srcObject = null; };
  }, [participant.videoTrack]);
  
  const badge = participant.role === "coHost" ? "CO" : participant.role.charAt(0).toUpperCase();
  
  return (
    <div className={`participant-video-tile ${participant.speaking ? "speaking" : ""}`}>
      <video ref={videoRef} playsInline autoPlay />
      <div className="participant-video-label">
        <span className="participant-video-name">
          {participant.displayName} <span className={`participant-role-badge ${participant.role}`}>{badge}</span>
        </span>
        {participant.audioTrack && (
          <AudioIndicator speaking={participant.speaking} audioLevel={participant.audioLevel} size="small" />
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
