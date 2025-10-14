// EgressTemplate.jsx - Production-grade LiveKit egress recording template
import React, { useMemo, useEffect } from "react";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useRemoteParticipants,
  useTracks,
  useRoomContext,
  useSpeakingParticipants,
  ParticipantLoop,
} from "@livekit/components-react";
import EgressHelper from "@livekit/egress-sdk"; // CRITICAL!

import { Track } from "livekit-client";
import MainView from "./components/MainView";
import Sidebar from "./components/Sidebar";
import { useLayoutCalculation } from "./hooks/useLayoutCalculation";

// Parse display name from metadata or fallback to identity
function parseDisplayName(metadata, identity) {
  if (!metadata) return identity;
  try {
    const parsed = JSON.parse(metadata);
    return parsed?.displayName || parsed?.name || parsed?.username || identity;
  } catch {
    return typeof metadata === "string" && metadata.length < 64
      ? metadata
      : identity;
  }
}

// Extract role from metadata/attributes
function getParticipantRole(participant) {
  // Check attributes first (preferred)
  if (participant.attributes?.role) {
    const role = participant.attributes.role;
    if (["host", "coHost", "participant"].includes(role)) {
      return role;
    }
  }

  // Fallback to metadata
  try {
    const parsed = JSON.parse(participant.metadata || "{}");
    const role = parsed?.role;
    return ["host", "coHost", "participant"].includes(role)
      ? role
      : "participant";
  } catch {
    return "participant";
  }
}

// Filter out egress/recorder participants
function isEgressParticipant(participant) {
  if (participant.kind === "egress") return true;
  const id = participant.identity?.toLowerCase() || "";
  const md = participant.metadata?.toLowerCase() || "";

  return (
    id.includes("egress-") ||
    id.includes("recorder-") ||
    id.includes("recording-") ||
    id.startsWith("egress_") ||
    id.startsWith("recorder_") ||
    md.includes('"egress"') ||
    md.includes('"recorder"')
  );
}

/**
 * Inner template component that uses LiveKit hooks within room context
 */
function EgressTemplateInner() {
  const room = useRoomContext();
  const allParticipants = useParticipants();
  const speakingParticipants = useSpeakingParticipants();

  // Get all tracks for screen share detection
  const screenShareTracks = useTracks([Track.Source.ScreenShare], {
    onlySubscribed: false,
  });

  const cameraVideoTracks = useTracks([Track.Source.Camera], {
    onlySubscribed: false,
  });
  // ===== CRITICAL FIX: Add this useEffect block =====
  useEffect(() => {
    if (!room) return;

    console.log("🎯 EGRESS: Setting up egress helper with room:", room.name);

    try {
      // STEP 1: Register the room with egress helper
      EgressHelper.setRoom(room);
      console.log("✅ EGRESS: Room registered with EgressHelper");
    } catch (error) {
      console.error("❌ EGRESS: Failed to set room:", error);
    }

    // STEP 2: Set up recording start logic
    let startCheckInterval;
    let hasStarted = false;

    const checkAndStartRecording = () => {
      if (hasStarted) return;

      const realParticipants = allParticipants.filter(
        (p) => !isEgressParticipant(p)
      );
      const hasParticipants = realParticipants.length > 0;

      console.log("🎯 EGRESS: Recording check:", {
        hasParticipants,
        participantCount: realParticipants.length,
        roomState: room.state,
      });

      // Start recording if we have participants and room is connected
      if (hasParticipants && room.state === "connected") {
        hasStarted = true;
        console.log("🚀 EGRESS: Starting recording...");
        console.log("START_RECORDING"); // CRITICAL: This is what egress waits for!

        try {
          EgressHelper.startRecording();
          console.log("✅ EGRESS: Recording started successfully");
        } catch (error) {
          console.error("❌ EGRESS: Failed to start recording:", error);
        }

        clearInterval(startCheckInterval);
      }
    };

    // Start checking after a short delay to allow room to fully initialize
    const initialDelay = setTimeout(() => {
      checkAndStartRecording();
      startCheckInterval = setInterval(checkAndStartRecording, 1000);
    }, 1000);

    // Cleanup
    return () => {
      clearTimeout(initialDelay);
      if (startCheckInterval) {
        clearInterval(startCheckInterval);
      }
    };
  }, [room, allParticipants]);
  // ===== END OF CRITICAL FIX =====

  // Process participants and categorize them
  const participantData = useMemo(() => {
    const realParticipants = allParticipants.filter(
      (p) => !isEgressParticipant(p)
    );

    let host = null;
    const coHosts = [];
    const participants = [];
    const speakingIds = new Set(speakingParticipants.map((p) => p.identity));

    realParticipants.forEach((participant) => {
      const role = getParticipantRole(participant);
      const displayName = parseDisplayName(
        participant.metadata,
        participant.identity
      );
      const isSpeaking = speakingIds.has(participant.identity);

      const participantInfo = {
        participant,
        role,
        displayName,
        isSpeaking,
        identity: participant.identity,
      };

      if (role === "host") {
        host = participantInfo;
      } else if (role === "coHost") {
        coHosts.push(participantInfo);
      } else {
        participants.push(participantInfo);
      }
    });

    // Sort participants by speaking activity (most recent speakers first)
    participants.sort((a, b) => {
      if (a.isSpeaking && !b.isSpeaking) return -1;
      if (!a.isSpeaking && b.isSpeaking) return 1;
      // For now, we'll use identity as secondary sort since we don't have lastSpokeAt
      return a.identity.localeCompare(b.identity);
    });

    return { host, coHosts, participants };
  }, [allParticipants, speakingParticipants]);

  // Find host's screen share
  const hostScreenShare = useMemo(() => {
    if (!participantData.host) return null;

    return screenShareTracks.find(
      (trackRef) =>
        trackRef.participant.identity === participantData.host.identity
    );
  }, [screenShareTracks, participantData.host]);

  // Find host's camera track
  const hostCameraTrack = useMemo(() => {
    if (!participantData.host) return null;

    return cameraVideoTracks.find(
      (trackRef) =>
        trackRef.participant.identity === participantData.host.identity
    );
  }, [cameraVideoTracks, participantData.host]);

  // Calculate layout percentages
  const layout = useLayoutCalculation({
    hasCoHosts: participantData.coHosts.length > 0,
  });

  return (
    <div
      className="egress-template"
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        backgroundColor: "#000",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
      role="main"
      aria-label="Video conference recording"
    >
      {/* Main View - 80% or 90% depending on coHosts */}
      <div
        className="main-view-container"
        style={{
          width: `${layout.mainWidth}%`,
          height: "100%",
          position: "relative",
        }}
      >
        <MainView
          host={participantData.host}
          screenShareTrack={hostScreenShare}
          cameraTrack={hostCameraTrack}
        />
      </div>

      {/* Sidebar - 20% or 10% depending on coHosts */}
      <div
        className="sidebar-container"
        style={{
          width: `${layout.sidebarWidth}%`,
          height: "100%",
          backgroundColor: "#1a1a1a",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Sidebar
          coHosts={participantData.coHosts}
          participants={participantData.participants}
          cameraVideoTracks={cameraVideoTracks}
        />
      </div>

      {/* Audio renderer for all participants */}
      <RoomAudioRenderer />
    </div>
  );
}

/**
 * Main EgressTemplate component that provides room context
 * This is the component that will be used by livekit-egress
 */
export default function EgressTemplate({
  serverUrl,
  token,
  room,
  options = {},
}) {
  
  const urlParams = new URLSearchParams(window.location.search);
  const finalServerUrl = serverUrl || urlParams.get("url");
  const finalToken = token || urlParams.get("token");

  if (!finalServerUrl || !finalToken) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#000",
          color: "#fff",
          fontFamily: "monospace",
          fontSize: "16px",
          textAlign: "center",
        }}
        role="alert"
        aria-live="polite"
      >
        <div>
          <h2>LiveKit Egress Template</h2>
          <p>Missing required parameters:</p>
          <code>?url=&lt;websocket-url&gt;&amp;token=&lt;access-token&gt;</code>
          <p style={{ marginTop: "20px", fontSize: "14px", opacity: 0.8 }}>
            Ensure your LiveKit server URL and access token are provided
            correctly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={finalServerUrl}
      token={finalToken}
      room={room}
      connect={true}
      audio={false} // Don't publish audio in egress
      video={false} // Don't publish video in egress
      options={{
        // Optimized settings for egress recording
        adaptiveStream: false,
        dynacast: false,
        publishDefaults: {
          videoSimulcast: false,
          audioPreset: undefined,
        },
        ...options,
      }}
      onError={(error) => {
        console.error("LiveKit connection error:", error);
      }}
      onDisconnected={(reason) => {
        console.log("🔌 EGRESS: Disconnected from LiveKit:", reason);
        console.log("END_RECORDING"); // ADD THIS LINE
      }}
      onConnected={() => {
        console.log("Connected to LiveKit room for egress recording");
      }}
    >
      <EgressTemplateInner />
    </LiveKitRoom>
  );
}

// Export additional components for testing
export {
  EgressTemplateInner,
  parseDisplayName,
  getParticipantRole,
  isEgressParticipant,
};
