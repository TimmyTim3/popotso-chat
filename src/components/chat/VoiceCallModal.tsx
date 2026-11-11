import {
  AlertCircle,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RefreshCw,
  Video,
  Volume2,
  VolumeX,
  Wifi,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { MEMBERS, type MemberEmail } from "@/lib/care-desk";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sounds";

interface VoiceCallModalProps {
  myId: string;
  myEmail: string;
  partnerEmail: MemberEmail;
  channel: RealtimeChannel;
  initialVideo?: boolean;
  incomingCall: {
    callerId: string;
    callerName: string;
    sdp: RTCSessionDescriptionInit;
    isVideo?: boolean;
  } | null;
  onClose: (summary: { connected: boolean; durationSeconds: number; dataBytes: number; video: boolean; outcome: 'completed' | 'missed' | 'no-answer' | 'declined'; initiatedByMe: boolean }) => void;
}

type CallStatus = "connecting" | "ringing" | "incoming" | "connected" | "ended";

export function VoiceCallModal({
  myId,
  myEmail,
  partnerEmail,
  channel,
  initialVideo = false,
  incomingCall,
  onClose,
}: VoiceCallModalProps) {
  const isCaller = !incomingCall;
  const [status, setStatus] = useState<CallStatus>(isCaller ? "connecting" : "incoming");
  const [isVideo, setIsVideo] = useState(incomingCall ? Boolean(incomingCall.isVideo) : initialVideo);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [muted, setMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const secondsRef = useRef(0);
  secondsRef.current = seconds;
  const connectedRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const closeOnceRef = useRef(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const flushPendingIceCandidates = async (pc: RTCPeerConnection) => {
    const pending = pendingIceCandidatesRef.current.splice(0);
    for (const candidate of pending) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (error) { console.warn("Could not apply queued call network candidate", error); }
    }
  };

  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vibrateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const partnerLabel = MEMBERS[partnerEmail] ?? "Partner";

  // Realistic phone ringtone synthesizer (Web Audio API) + physical phone vibration
  const startRingtone = useCallback((isIncoming: boolean) => {
    stopRingtone();
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = "sine";
      osc2.type = "sine";
      osc1.frequency.value = isIncoming ? 440 : 425;
      osc2.frequency.value = isIncoming ? 554 : 425;
      gain.gain.value = 0;

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start();
      osc2.start();

      let on = false;
      const pulse = () => {
        if (!gain || !ctx) return;
        on = !on;
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(on ? 0.15 : 0, now);
      };
      pulse();
      ringIntervalRef.current = setInterval(pulse, isIncoming ? 800 : 1500);

      if (typeof navigator !== "undefined" && "vibrate" in navigator && localStorage.getItem("popotso-vibration-enabled") !== "false") {
        navigator.vibrate([400, 200, 400, 1000]);
        vibrateIntervalRef.current = setInterval(() => {
          navigator.vibrate([400, 200, 400, 1000]);
        }, 2000);
      }
    } catch {
      // AudioContext restriction
    }
  }, []);

  const stopRingtone = useCallback(() => {
    try {
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
      if (vibrateIntervalRef.current) {
        clearInterval(vibrateIntervalRef.current);
        vibrateIntervalRef.current = null;
      }
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(0);
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    } catch {
      // Ignore cleanup error
    }
  }, []);

  // Standard recommended WebRTC SDP clamping: Opus 24kbps audio + ~450kbps HD video
  const applyBalancedSDP = (sdp: string, hasVideo: boolean) => {
    let result = sdp.replace(
      /a=mid:audio\r\n/gi,
      "a=mid:audio\r\na=fmtp:111 minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=24000\r\n",
    );
    if (hasVideo) {
      result = result.replace(/(m=video [^\r\n]+\r\n)/gi, "$1b=AS:450\r\n");
    }
    return result;
  };

  const endCall = useCallback(
    (notify = true) => {
      stopRingtone();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      const pc = pcRef.current;
      const finish = async () => {
        let dataBytes = 0;
        if (pc) {
          try {
            const stats = await pc.getStats();
            stats.forEach((report) => {
              if (report.type === "outbound-rtp" && !report.isRemote) dataBytes += Number(report.bytesSent ?? 0);
              if (report.type === "inbound-rtp" && !report.isRemote) dataBytes += Number(report.bytesReceived ?? 0);
            });
          } catch (error) { console.warn("Could not read call data usage", error); }
        }
        const durationSeconds = startedAtRef.current ? Math.max(secondsRef.current, Math.floor((Date.now() - startedAtRef.current) / 1000)) : 0;
        const outcome = connectedRef.current ? "completed" : incomingCall ? "declined" : "no-answer";
        if (!closeOnceRef.current) {
          closeOnceRef.current = true;
          onClose({ connected: connectedRef.current, durationSeconds, dataBytes, video: isVideo, outcome, initiatedByMe: isCaller });
        }
      };
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (pc) { pc.close(); pcRef.current = null; }

      localStreamRef.current = null;
      remoteStreamRef.current = null;

      if (notify) {
        void channel.send({
          type: "broadcast",
          event: "call-hangup",
          payload: { from: myId },
        });
      }

      setStatus("ended");
      setTimeout(() => { void finish(); }, 600);
    },
    [channel, myId, onClose, stopRingtone, incomingCall, isVideo],
  );

  const setupPeerConnection = useCallback(
    async (enableVideo: boolean, face: "user" | "environment") => {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      pcRef.current = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          void channel.send({
            type: "broadcast",
            event: "call-ice",
            payload: { candidate: event.candidate, from: myId },
          });
        }
      };

      pc.ontrack = (event) => {
        // A remote SDP answer is not proof that the call was picked up.
        // Start billing/display time only once remote media actually arrives.
        stopRingtone();
        connectedRef.current = true;
        startedAtRef.current ??= Date.now();
        setStatus("connected");
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        remoteStreamRef.current = stream;

        if (remoteVideoRef.current && stream) {
          remoteVideoRef.current.srcObject = stream;
          void remoteVideoRef.current.play().catch(() => {});
        }
        if (remoteAudioRef.current && stream) {
          remoteAudioRef.current.srcObject = stream;
          void remoteAudioRef.current.play().catch(() => {});
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: enableVideo
          ? {
              facingMode: face,
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { max: 24 },
            }
          : false,
      });

      localStreamRef.current = stream;
      if (localVideoRef.current && enableVideo) {
        localVideoRef.current.srcObject = stream;
        void localVideoRef.current.play().catch(() => {});
      }

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      return pc;
    },
    [channel, myId, stopRingtone],
  );

  // Caller flow
  useEffect(() => {
    if (!isCaller) {
      playSound("call");
      startRingtone(true);
      return;
    }

    setStatus("connecting");
    playSound("call");
    startRingtone(false);

    void (async () => {
      try {
        const pc = await setupPeerConnection(isVideo, facingMode);
        const offer = await pc.createOffer();
        const balancedSDP = applyBalancedSDP(offer.sdp ?? "", isVideo);
        const finalOffer = { type: offer.type, sdp: balancedSDP };
        await pc.setLocalDescription(finalOffer);

        void channel.send({
          type: "broadcast",
          event: "call-offer",
          payload: {
            callerId: myId,
            callerName: MEMBERS[myEmail as MemberEmail] ?? "Father",
            sdp: finalOffer,
            isVideo,
          },
        });

        setStatus("ringing");
      } catch (err: any) {
        console.error("Call setup error", err);
        stopRingtone();
        setPermissionError(
          err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError"
            ? "Microphone and camera permissions were denied. Tap the lock/tune icon in your browser address bar to allow permissions."
            : "Could not access audio/camera device. Please check your settings."
        );
      }
    })();

    return () => {
      stopRingtone();
    };
  }, [endCall, facingMode, isCaller, isVideo, myEmail, myId, setupPeerConnection, startRingtone, stopRingtone, channel]);
          const acceptCall = async () => {
    if (!incomingCall) return;
    haptic("success");
    stopRingtone();
    try {
      const pc = await setupPeerConnection(isVideo, facingMode);
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.sdp));
      const answer = await pc.createAnswer();
      const balancedSDP = applyBalancedSDP(answer.sdp ?? "", isVideo);
      const finalAnswer = { type: answer.type, sdp: balancedSDP };
      await pc.setLocalDescription(finalAnswer);

      void channel.send({
        type: "broadcast",
        event: "call-answer",
        payload: { calleeId: myId, sdp: finalAnswer },
      });
      // The call is accepted but not connected until remote audio/video arrives.
      setStatus("connecting");
    } catch (err: any) {
      stopRingtone();
      setPermissionError("Could not access microphone or camera to accept call.");
    }
  };

  // Call duration timer
  useEffect(() => {
    if (status === "connected") {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  // Handle Realtime incoming signals
  useEffect(() => {
    const handleAnswer = async (event: { payload: unknown }) => {
      const payload = event.payload as { calleeId?: string; sdp?: RTCSessionDescriptionInit } | undefined;
      if (payload?.sdp && pcRef.current) {
        stopRingtone();
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        // Keep the UI in a connecting state until ontrack confirms remote media.
      }
    };

    const handleIce = async (event: { payload: unknown }) => {
      const payload = event.payload as { candidate?: RTCIceCandidateInit; from?: string } | undefined;
      if (payload?.candidate && payload.from !== myId && pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // Ignore candidate errors
        }
      }
    };

    const handleHangup = (event: { payload: unknown }) => {
      const payload = event.payload as { from?: string } | undefined;
      if (payload?.from !== myId) {
        endCall(false);
      }
    };

    channel.on("broadcast", { event: "call-answer" }, handleAnswer);
    channel.on("broadcast", { event: "call-ice" }, handleIce);
    channel.on("broadcast", { event: "call-hangup" }, handleHangup);

    return () => {
      stopRingtone();
    };
  }, [channel, endCall, myId, status, stopRingtone]);

  const toggleMute = () => {
    haptic("light");
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setMuted(!track.enabled);
      }
    }
  };

  const toggleVideoMute = () => {
    haptic("light");
    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setVideoMuted(!track.enabled);
      }
    }
  };

  const toggleSpeaker = () => {
    haptic("light");
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !remoteAudioRef.current.muted;
      setSpeakerMuted(remoteAudioRef.current.muted);
    }
  };

  const flipCamera = async () => {
    haptic("medium");
    const nextMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextMode);

    if (localStreamRef.current && pcRef.current) {
      try {
        const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: nextMode, width: { ideal: 640 }, height: { ideal: 480 } },
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (newVideoTrack && oldVideoTrack) {
          const sender = pcRef.current.getSenders().find((s) => s.track?.kind === "video");
          if (sender) await sender.replaceTrack(newVideoTrack);
          localStreamRef.current.removeTrack(oldVideoTrack);
          oldVideoTrack.stop();
          localStreamRef.current.addTrack(newVideoTrack);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
          }
        }
      } catch (err) {
        console.warn("Could not flip camera", err);
      }
    }
  };

  const formatCallTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const dataUsedMB = isVideo
    ? ((seconds * 45) / 1024).toFixed(1)
    : ((seconds * 2.5) / 1024).toFixed(2);

  const statusText =
    status === "connecting"
      ? "Connecting..."
      : status === "ringing"
        ? "Ringing phone..."
        : status === "incoming"
          ? isVideo ? "Incoming Video Call..." : "Incoming Voice Call..."
          : status === "connected"
            ? formatCallTime(seconds)
            : "Call Ended";

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between bg-black text-white backdrop-blur-2xl">
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Main Video View or Audio Avatar */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {isVideo && status === "connected" ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="size-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-28 items-center justify-center rounded-full bg-secondary/20 shadow-2xl backdrop-blur-lg">
              <span className="text-4xl font-semibold tracking-tight text-white/90">
                {partnerLabel[0]}
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight">{partnerLabel}</h2>
            <p className="text-sm font-medium text-white/70">{statusText}</p>
            {status === "connected" && (
              <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
                <Wifi className="size-3 text-emerald-400" />
                <span>Opus ~24 kbps • {dataUsedMB} MB used</span>
              </div>
            )}
          </div>
        )}

        {/* Small Picture-in-Picture Local Video */}
        {isVideo && (
          <div className="absolute top-6 right-6 z-10 h-36 w-24 overflow-hidden rounded-2xl border-2 border-white/20 bg-black/60 shadow-2xl">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="size-full object-cover"
            />
          </div>
        )}

        {/* Permission Denied Card */}
        {permissionError && (
          <div className="absolute inset-x-6 top-1/3 z-30 rounded-3xl border border-destructive/40 bg-zinc-900/95 p-6 text-center shadow-2xl backdrop-blur-xl">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-destructive/20 text-destructive">
              <AlertCircle className="size-6" />
            </div>
            <h3 className="mb-2 text-base font-bold text-white">Permission Needed</h3>
            <p className="mb-4 text-xs leading-relaxed text-zinc-300">{permissionError}</p>
            <button
              type="button"
              onClick={() => endCall(false)}
              className="rounded-full bg-secondary px-5 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Incoming Call Accept/Decline Bar */}
      {status === "incoming" && !permissionError && (
        <div className="flex items-center justify-around pb-12 pt-6">
          <button
            type="button"
            onClick={() => endCall(true)}
            className="flex size-16 items-center justify-center rounded-full bg-destructive text-white shadow-xl transition hover:scale-105 active:scale-95"
            aria-label="Decline call"
          >
            <PhoneOff className="size-7" />
          </button>
          <button
            type="button"
            onClick={acceptCall}
            className="flex size-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-xl transition hover:scale-105 active:scale-95"
            aria-label="Accept call"
          >
            <Phone className="size-7" />
          </button>
        </div>
      )}

      {/* Connected or Outgoing Calling Control Bar */}
      {status !== "incoming" && !permissionError && (
        <div className="flex items-center justify-center gap-5 pb-12 pt-6">
          {/* Mute Mic */}
          <button
            type="button"
            onClick={toggleMute}
            className={`flex size-12 items-center justify-center rounded-full transition active:scale-95 ${
              muted ? "bg-white text-black" : "bg-white/15 text-white backdrop-blur-lg"
            }`}
            aria-label={muted ? "Unmute mic" : "Mute mic"}
          >
            {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>

          {/* Toggle Video */}
          <button
            type="button"
            onClick={() => {
              const next = !isVideo;
              setIsVideo(next);
              toggleVideoMute();
            }}
            className={`flex size-12 items-center justify-center rounded-full transition active:scale-95 ${
              videoMuted || !isVideo
                ? "bg-white/15 text-white/50"
                : "bg-white text-black"
            }`}
            aria-label="Toggle camera"
          >
            {isVideo ? <Video className="size-5" /> : <CameraOff className="size-5" />}
          </button>

          {/* Flip Camera */}
          {isVideo && (
            <button
              type="button"
              onClick={flipCamera}
              className="flex size-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-lg transition active:scale-95"
              aria-label="Flip camera"
            >
              <RefreshCw className="size-5" />
            </button>
          )}

          {/* Speaker Mute */}
          <button
            type="button"
            onClick={toggleSpeaker}
            className={`flex size-12 items-center justify-center rounded-full transition active:scale-95 ${
              speakerMuted ? "bg-white text-black" : "bg-white/15 text-white backdrop-blur-lg"
            }`}
            aria-label={speakerMuted ? "Unmute speaker" : "Mute speaker"}
          >
            {speakerMuted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>

          {/* End Call */}
          <button
            type="button"
            onClick={() => endCall(true)}
            className="flex size-14 items-center justify-center rounded-full bg-destructive text-white shadow-xl transition hover:scale-105 active:scale-95"
            aria-label="End call"
          >
            <PhoneOff className="size-6" />
          </button>
        </div>
      )}
    </div>
  );
}
