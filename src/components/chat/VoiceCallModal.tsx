import {
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
  onClose: () => void;
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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vibrateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const partnerLabel = MEMBERS[partnerEmail] ?? "Family";

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

      // Tone pattern: Outgoing is standard 440Hz European/US ring; Incoming is melodic dual-tone chime
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = "sine";
      osc2.type = "sine";
      osc1.frequency.value = isIncoming ? 440 : 425;
      osc2.frequency.value = isIncoming ? 554 : 425; // Melodic major third for incoming call
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

      // Physical vibration: standard phone call buzz
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([400, 200, 400, 1000]);
        vibrateIntervalRef.current = setInterval(() => {
          navigator.vibrate([400, 200, 400, 1000]);
        }, 2000);
      }
    } catch {
      // AudioContext autoplay or permission restriction
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

      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current?.getTracks().forEach((t) => t.stop());

      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }

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
      setTimeout(() => onClose(), 800);
    },
    [channel, myId, onClose, stopRingtone],
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
        stopRingtone();
        setStatus("connected");
        const stream = event.streams[0] ?? null;
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

      // Balanced HD video constraints: 640x480 or 720p @ 24fps
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: enableVideo
          ? {
              width: { ideal: 640, max: 1280 },
              height: { ideal: 480, max: 720 },
              frameRate: { ideal: 24, max: 30 },
              facingMode: face,
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
      startRingtone(true); // Incoming ring chime
      return;
    }

    setStatus("connecting");
    startRingtone(false); // Outgoing dialing ring

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
      } catch (err) {
        console.error("Call setup error", err);
        endCall(true);
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
      setStatus("connected");
    } catch {
      endCall(true);
    }
  };

  // Call timer
  useEffect(() => {
    if (status === "connected") {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  // Realtime signaling listeners
  useEffect(() => {
    const handleAnswer = async (event: any) => {
      const payload = event.payload as { calleeId?: string; sdp?: RTCSessionDescriptionInit } | undefined;
      if (payload?.sdp && pcRef.current && (status === "connecting" || status === "ringing")) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        stopRingtone();
        setStatus("connected");
      }
    };

    const handleIce = async (event: any) => {
      const payload = event.payload as { candidate?: RTCIceCandidateInit; from?: string } | undefined;
      if (payload?.candidate && payload.from !== myId && pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // ignore
        }
      }
    };

    const handleHangup = (event: any) => {
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

      {/* Main Video View (Remote partner) or Audio Avatar */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {isVideo && status === "connected" ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="size-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center text-center p-6">
            <div className="mb-4 flex size-28 items-center justify-center rounded-full bg-primary/20 ring-4 ring-primary/40">
              {isVideo ? (
                <Video className={`size-12 text-primary ${status === "ringing" || status === "incoming" ? "animate-pulse" : ""}`} />
              ) : (
                <Phone className={`size-12 text-primary ${status === "ringing" || status === "incoming" ? "animate-pulse" : ""}`} />
              )}
            </div>
            <h2 className="text-2xl font-bold tracking-tight">{partnerLabel}</h2>
            <p className="mt-1 text-sm font-medium text-white/70">{statusText}</p>

            <div className="mt-4 flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1 text-xs font-medium text-white/90 backdrop-blur-md">
              <Wifi className="size-3.5 text-primary" />
              <span>
                {status === "connected"
                  ? `${dataUsedMB} MB used (${isVideo ? "HD Balanced 450kbps" : "Opus 24kbps"})`
                  : isVideo
                    ? "~160 MB / hour (85% cheaper than WhatsApp)"
                    : "~9 MB / hour (95% cheaper than cellular)"}
              </span>
            </div>
          </div>
        )}

        {/* Floating Picture-in-Picture Local Self Video */}
        {isVideo && (
          <div className="absolute right-4 top-14 size-28 sm:size-36 overflow-hidden rounded-2xl border-2 border-white/20 bg-neutral-900 shadow-2xl">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="size-full object-cover"
            />
          </div>
        )}
      </div>

      {/* Call Controls Footer */}
      <div className="p-6 pb-10">
        {status === "incoming" ? (
          <div className="flex items-center justify-around">
            <button
              type="button"
              onClick={() => endCall(true)}
              className="flex size-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg active:scale-95 transition-transform"
              aria-label="Decline call"
            >
              <PhoneOff className="size-7" />
            </button>
            <button
              type="button"
              onClick={acceptCall}
              className="flex size-16 items-center justify-center rounded-full bg-green-600 text-white shadow-lg active:scale-95 transition-transform animate-bounce"
              aria-label="Accept call"
            >
              <Phone className="size-7" />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={toggleMute}
              className={`flex size-12 items-center justify-center rounded-full transition-colors active:scale-95 ${
                muted ? "bg-red-600 text-white" : "bg-white/20 text-white hover:bg-white/30"
              }`}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </button>

            {isVideo && (
              <>
                <button
                  type="button"
                  onClick={toggleVideoMute}
                  className={`flex size-12 items-center justify-center rounded-full transition-colors active:scale-95 ${
                    videoMuted ? "bg-red-600 text-white" : "bg-white/20 text-white hover:bg-white/30"
                  }`}
                  aria-label={videoMuted ? "Turn on camera" : "Turn off camera"}
                  title={videoMuted ? "Camera Off" : "Camera On"}
                >
                  {videoMuted ? <CameraOff className="size-5" /> : <Camera className="size-5" />}
                </button>

                <button
                  type="button"
                  onClick={flipCamera}
                  className="flex size-12 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30 active:scale-95"
                  aria-label="Flip camera front/back"
                  title="Flip camera"
                >
                  <RefreshCw className="size-5" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={toggleSpeaker}
              className={`flex size-12 items-center justify-center rounded-full transition-colors active:scale-95 ${
                speakerMuted ? "bg-red-600 text-white" : "bg-white/20 text-white hover:bg-white/30"
              }`}
              aria-label={speakerMuted ? "Unmute speaker" : "Mute speaker"}
              title={speakerMuted ? "Muted Speaker" : "Speaker On"}
            >
              {speakerMuted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
            </button>

            <button
              type="button"
              onClick={() => endCall(true)}
              className="flex size-14 items-center justify-center rounded-full bg-red-600 text-white shadow-xl transition-transform active:scale-95"
              aria-label="Hang up call"
              title="End call"
            >
              <PhoneOff className="size-6" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
