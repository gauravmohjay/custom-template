// src/App.jsx - Converted to Tailwind CSS

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
    <div className="fixed top-5 right-5 z-[1000] flex flex-col gap-3 max-w-[350px] pointer-events-none">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`flex items-center gap-3 px-5 py-4 bg-slate-800/95 border border-slate-600/30 rounded-xl backdrop-blur-xl shadow-2xl transition-all duration-300 ease-out pointer-events-auto ${
            n.type === "join" 
              ? "border-l-4 border-l-green-500" 
              : "border-l-4 border-l-red-500"
          } ${
            n.isVisible 
              ? "translate-x-0 opacity-100" 
              : "translate-x-full opacity-0"
          }`}
        >
          <div className="text-2xl flex-shrink-0">👋</div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-100 mb-1">
              {n.type === "join" ? "Participant Joined" : "Participant Left"}
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide text-white ${
                n.role === "host" 
                  ? "bg-red-500" 
                  : n.role === "coHost" 
                  ? "bg-sky-500" 
                  : "bg-slate-600"
              }`}>
                {n.role === "coHost" ? "coHost" : n.role.toUpperCase()}
              </span>
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
  const { participants, setParticipant, removeParticipant, setParticipants } = useParticipants(room);
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
      <div className="font-inter bg-slate-900 text-slate-100 min-h-screen p-4 flex flex-col relative">
        <div className="flex justify-between items-center mb-4 px-6 py-3.5 bg-slate-900/80 rounded-xl backdrop-blur-xl border border-slate-600/20 shadow-lg">
          <div className="flex items-center gap-3 font-semibold text-base">
            <div 
              className="w-3 h-3 bg-red-500 rounded-full animate-pulse"
              style={{
                animationName: 'pulse-recording',
                animationDuration: '2s',
                animationIterationCount: 'infinite'
              }}
            ></div>
            <span>Live Recording Session</span>
          </div>
          <div className="text-sm text-slate-400 font-medium">
            {allParticipants.length} participant{allParticipants.length !== 1 ? "s" : ""}
            {mainStageParticipant && ` • Main: ${mainStageParticipant.displayName} (${mainStageParticipant.role})`}
          </div>
        </div>
        
        <div className="flex flex-row-reverse gap-4 flex-1 min-h-0">
          {/* Left Panel - coHost Videos and Other Participants */}
          <div className="flex-none w-1/5 flex flex-col gap-3 min-h-0">
            {/* coHost Videos Section */}
            <div className="flex-none h-3/5 bg-slate-800/40 rounded-xl flex flex-col overflow-hidden border border-slate-600/20">
              <div className="px-4 py-3 bg-slate-900/60 border-b border-slate-600/20 flex justify-between items-center font-semibold text-xs">
                <span>coHost Videos</span>
                <span className="bg-slate-600 text-slate-200 px-1.5 py-0.5 rounded text-[10px] font-bold">{coHostVideoParticipants.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-slate-600/10 [&::-webkit-scrollbar-track]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-slate-600/40 [&::-webkit-scrollbar-thumb]:rounded-sm">
                {coHostVideoParticipants.length > 0 ? (
                  <div className="mb-4">
                    <div className="grid grid-cols-1 gap-1.5">
                      {coHostVideoParticipants.map((p) => (
                        <ParticipantVideoTile key={p.identity} participant={p} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-5 opacity-50">
                    <div className="text-2xl mb-2">📹</div>
                    <div className="text-[11px] text-slate-400 font-medium">No coHost videos</div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Other Participants List */}
            <div className="flex-none h-[38%] bg-slate-800/40 rounded-xl flex flex-col overflow-hidden border border-slate-600/20">
              <div className="px-4 py-3 bg-slate-900/60 border-b border-slate-600/20 flex justify-between items-center font-semibold text-xs">
                <span>Other Participants</span>
                <span className="bg-green-500 text-white px-1.5 py-0.5 rounded text-[10px] font-bold">
                  {displayedOthers.length}
                  {remainingCount > 0 ? `+${remainingCount}` : ""}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-slate-600/10 [&::-webkit-scrollbar-track]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-slate-600/40 [&::-webkit-scrollbar-thumb]:rounded-sm">
                <div className="flex flex-col gap-1">
                  {displayedOthers.map((p) => (
                    <div
                      key={p.identity}
                      className={`flex items-center gap-2 px-2 py-1.5 bg-slate-600/15 rounded-md border border-transparent transition-all duration-200 relative ${
                        p.speaking ? "bg-green-500/10 border-green-500/30" : ""
                      }`}
                      title={p.displayName}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold text-white flex-shrink-0 ${
                        p.role === "host" 
                          ? "bg-gradient-to-br from-red-500 to-red-600" 
                          : p.role === "coHost" 
                          ? "bg-gradient-to-br from-sky-500 to-blue-600" 
                          : "bg-gradient-to-br from-slate-600 to-slate-700"
                      }`}>
                        {p.displayName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2)}
                      </div>
                      <div className="flex-1 text-[10px] font-semibold text-slate-100 truncate">{p.displayName}</div>
                      {p.speaking && <div className="text-[8px] text-green-500">🔊</div>}
                      {!p.videoTrack && !p.audioTrack && (
                        <div className="text-[8px]">📱</div>
                      )}
                    </div>
                  ))}
                  {remainingCount > 0 && (
                    <div className="px-2 py-1.5 text-center text-[10px] text-slate-400 font-semibold bg-slate-600/10 rounded-md mt-1">
                      +{remainingCount} more
                    </div>
                  )}
                </div>
                {displayedOthers.length === 0 && (
                  <div className="flex flex-col items-center justify-center p-5 opacity-50">
                    <div className="text-xl mb-2">👥</div>
                    <div className="text-[10px] text-slate-400 font-medium">No other participants</div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Main Stage - ONLY HOST */}
          <div className={`flex-none w-4/5 bg-black rounded-2xl overflow-hidden relative min-h-[450px] border-3 border-transparent transition-all duration-300 shadow-2xl ${
            mainStageParticipant?.speaking ? "border-green-500 shadow-green-500/15" : ""
          }`}>
            {mainStageParticipant ? (
              <MainStageTile participant={mainStageParticipant} />
            ) : (
              <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-800 to-slate-700">
                <div className="text-center opacity-70">
                  <div className="text-6xl mb-5">🎥</div>
                  <div className="text-xl font-semibold text-slate-100 mb-2">Waiting for host...</div>
                  <div className="text-sm text-slate-400 font-medium">Recording will start automatically</div>
                </div>
              </div>
            )}
          </div>
        </div>
        
        <RoomAudioRenderer />
        <NotificationToast notifications={notifications} />
      </div>

      {/* Custom Styles for animations */}
      <style jsx>{`
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
      `}</style>
    </>
  );
}

// Audio level indicator
function AudioIndicator({ speaking, audioLevel, size = "small" }) {
  const bars = size === "large" ? 5 : 4;
  const containerClasses = size === "large" 
    ? "flex items-end gap-0.5 flex-shrink-0 w-7 h-4.5" 
    : "flex items-end gap-px flex-shrink-0 w-4 h-2.5";
  
  const barClasses = size === "large" ? "w-0.5 bg-green-500 rounded-sm" : "w-0.5 bg-green-500 rounded-sm";
  
  const barHeights = size === "large" 
    ? ["h-1", "h-1.5", "h-2", "h-2.5", "h-3.5"]
    : ["h-0.5", "h-1", "h-1.5", "h-2"];

  return (
    <div className={containerClasses}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`${barClasses} transition-all duration-100 ease-out ${
            speaking 
              ? `animate-pulse ${barHeights[i]}` 
              : `opacity-30 scale-y-30 ${barHeights[i]}`
          }`}
          style={{
            height: speaking ? `${Math.max(2, (audioLevel / 100) * (size === "large" ? 14 : 8))}px` : undefined,
            animationDelay: speaking ? `${i * 0.1}s` : "0s",
            animationName: speaking ? "audio-bars" : "none",
            animationDuration: "0.4s",
            animationIterationCount: "infinite",
            animationTimingFunction: "ease-in-out"
          }}
        />
      ))}
    </div>
  );
}

// Main stage video tile
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
    <div className={`w-full h-full relative flex items-center justify-center bg-black overflow-hidden ${
      participant.speaking ? "animate-pulse" : ""
    }`}>
      {participant.videoTrack ? (
        <>
          <video 
            ref={videoRef} 
            playsInline 
            autoPlay 
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute bottom-5 left-5 right-5 bg-black/85 backdrop-blur-xl px-5 py-4 rounded-lg flex items-center justify-between border border-white/10">
            <div className="flex items-center flex-1">
              <div className={`text-white px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider mr-4 shadow-md ${
                participant.role === "host" 
                  ? "bg-gradient-to-br from-red-500 to-red-600" 
                  : participant.role === "coHost" 
                  ? "bg-gradient-to-br from-sky-500 to-blue-600" 
                  : "bg-gradient-to-br from-slate-600 to-slate-700"
              }`}>
                {badge}
              </div>
              <span className="text-lg font-semibold text-white flex-1 mr-4">{participant.displayName}</span>
            </div>
            {participant.audioTrack && (
              <AudioIndicator speaking={participant.speaking} audioLevel={participant.audioLevel} size="large" />
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full px-10 text-center">
          <div className={`w-35 h-35 rounded-full flex items-center justify-center text-5xl font-bold text-white mb-7 relative ${
            participant.role === "host" 
              ? "bg-gradient-to-br from-red-500 to-red-600" 
              : participant.role === "coHost" 
              ? "bg-gradient-to-br from-sky-500 to-blue-600" 
              : "bg-gradient-to-br from-indigo-600 to-purple-600"
          } ${
            participant.speaking ? "animate-pulse" : ""
          }`}
          style={{
            animationName: participant.speaking ? 'pulse-avatar' : 'none',
            animationDuration: '1.2s',
            animationIterationCount: 'infinite'
          }}
          >
            {initials}
          </div>
          <div className="text-3xl font-bold mb-2.5 text-slate-100">
            {participant.displayName}{" "}
            <span className={`text-white px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider shadow-md ${
              participant.role === "host" 
                ? "bg-gradient-to-br from-red-500 to-red-600" 
                : participant.role === "coHost" 
                ? "bg-gradient-to-br from-sky-500 to-blue-600" 
                : "bg-gradient-to-br from-slate-600 to-slate-700"
            }`}>
              {badge}
            </span>
          </div>
          <div className={`text-base font-medium ${
            participant.audioTrack ? "text-green-500" : "text-slate-400"
          }`}>
            {participant.audioTrack ? "Audio only" : "Not connected"}
          </div>
          {participant.audioTrack && (
            <div className="mt-5">
              <AudioIndicator speaking={participant.speaking} audioLevel={participant.audioLevel} size="large" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Video tile for participant
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
    <div className={`aspect-video bg-black rounded-lg overflow-hidden relative border-2 border-transparent transition-all duration-200 shadow-md ${
      participant.speaking ? "border-green-500 shadow-green-500/30" : ""
    }`}>
      <video 
        ref={videoRef} 
        playsInline 
        autoPlay 
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-1.5 left-1.5 right-1.5 bg-black/80 backdrop-blur-md px-2 py-1 rounded flex items-center justify-between">
        <span className="text-[10px] font-semibold text-white truncate flex-1">
          {participant.displayName}{" "}
          <span className={`text-[8px] font-semibold px-1 py-0.5 rounded ml-1 ${
            participant.role === "host" 
              ? "bg-red-500 text-white" 
              : participant.role === "coHost" 
              ? "bg-sky-500 text-white" 
              : "bg-slate-600 text-slate-200"
          }`}>
            {badge}
          </span>
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
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 font-inter p-6">
        <div className="text-center max-w-md bg-slate-800/80 px-10 py-10 rounded-2xl border border-slate-600/30">
          <h2 className="text-slate-100 mb-4 text-2xl font-semibold">⚠️ Configuration Required</h2>
          <p className="text-slate-300 mb-5 leading-relaxed">This recording template needs URL parameters:</p>
          <code className="bg-slate-900 px-4 py-3 rounded-lg font-mono text-green-400 block my-5 text-sm">
            ?url=&lt;websocket-url&gt;&token=&lt;access-token&gt;
          </code>
          <div className="mt-6 pt-5 border-t border-slate-600/30">
            <p className="text-sm text-slate-400">
              Make sure your LiveKit server URL and access token are provided correctly.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom serverUrl={wsUrl} token={token} connectOptions={{ autoSubscribe: true }}>
      <TemplateInner />
    </LiveKitRoom>
  );
}