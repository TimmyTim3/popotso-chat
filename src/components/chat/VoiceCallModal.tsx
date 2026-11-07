import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { MEMBERS, type MemberEmail } from "@/lib/care-desk";
import { haptic } from "@/lib/haptics";

interface VoiceCallModalProps {
  myId: string;
  myEmail: string;
  partnerEmail: MemberEmail;
  channel: RealtimeChannel;
  incomingCall: { callerId: string; callerName: string; sdp: RTCSessionDescriptionInit } | null;
  onClose: () => void;
}

export function VoiceCallModal({
  myId,
  myEmail,
  partnerEmail,
  channel,
  incomingCall,
  onClose,
}: VoiceCallModalProps) {
  const isCaller = !incomingCall;
  const [status, setStatus] = useState<"dialing" | "incoming" | "connected" | "ended">(
    isCaller ? "dialing" : "incoming",
  );
  const [muted, setMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const partnerLabel = MEMBERS[partnerEmail] ?? "Family";

  const startRingtone = useCallback(() => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })["webkitAudioContext"];
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      oscRef.current = osc;
    } catch {
      // autoplay restriction handled silently
    }
  }, []);

  const stopRingtone = useCallback(() => {
    try {
      oscRef.current?.stop();
      oscRef.current?.disconnect();
      void audioCtxRef.current?.close();
    } catch {
      // clean up
    }
    oscRef.current = null;
    audioCtxRef.current = null;
  }, []);

  // Clamp SDP to 16 kbps mono Opus for ultra-low data bundle usage
  const applyLowBitrateSDP = (sdp: string) =>
    sdp.replace(
      /a=mid:audio\r\n/gi,
      "a=mid:audio\r\na=fmtp:111 minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=16000\r\n",
    );

  const endCall = useCallback(
    (notify = true) => {
      stopRingtone();
      if (timerRef.current) clearInterval(timerRef.current);
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current = null;

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

  const setupPeerConnection = useCallback(async () => {
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
      if (remoteAudioRef.current && event.streams[0]) {
        remoteAudioRef.current.srcObject = event.streams[0];
        void remoteAudioRef.current.play().catch(() => {});
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
    localStreamRef.current = stream;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    return pc;
  }, [channel, myId, stopRingtone]);

  useEffect(() => {
    if (!isCaller) return;
    startRingtone();

    void (async () => {
      try {
        const pc = await setupPeerConnection();
        const offer = await pc.createOffer();
        const lowDataSDP = applyLowBitrateSDP(offer.sdp ?? "");
        const finalOffer = { type: offer.type, sdp: lowDataSDP };
        await pc.setLocalDescription(finalOffer);

        void channel.send({
          type: "broadcast",
          event: "call-offer",
          payload: {
            callerId: myId,
            callerName: MEMBERS[myEmail as MemberEmail] ?? "Father",
            sdp: finalOffer,
          },
        });
      } catch {
        endCall(true);
      }
    })();
  }, [endCall, isCaller, myEmail, myId, setupPeerConnection, startRingtone]);
    const acceptCall = async () => {
    if (!incomingCall) return;
    haptic("success");
    stopRingtone();
    try {
      const pc = await setupPeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.sdp));
      const answer = await pc.createAnswer();
      const lowDataSDP = applyLowBitrateSDP(answer.sdp ?? "");
      const finalAnswer = { type: answer.type, sdp: lowDataSDP };
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

  useEffect(() => {
    if (status === "connected") {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  useEffect(() => {
    channel.on("broadcast", { event: "call-answer" }, async (event) => {
      const payload = (event as Record<string, unknown>)["payload"] as
        | { calleeId?: string; sdp?: RTCSessionDescriptionInit }
        | undefined;
      if (payload?.sdp && pcRef.current && status === "dialing") {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        stopRingtone();
        setStatus("connected");
      }
    });

    channel.on("broadcast", { event: "call-ice" }, async (event) => {
      const payload = (event as Record<string, unknown>)["payload"] as
        | { candidate?: RTCIceCandidateInit; from?: string }
        | undefined;
      if (payload?.candidate && payload.from !== myId && pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // ignore candidate error
        }
      }
    });

    channel.on("broadcast", { event: "call-hangup" }, (event) => {
      const payload = (event as Record<string, unknown>)["payload"] as { from?: string } | undefined;
      if (payload?.from !== myId) {
        endCall(false);
      }
    });
  }, [channel, endCall, myId, status, stopRingtone]);

  const toggleMute = () => {
    haptic("light");
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMuted(!audioTrack.enabled);
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

  const formatCallTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const dataUsedMB = ((seconds * 2) / 1024).toFixed(2);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-background/95 p-6 backdrop-blur-2xl animate-fade-up">
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="mt-12 flex flex-col items-center text-center">
        <div className="mb-4 flex size-24 items-center justify-center rounded-full bg-primary/10 ring-4 ring-primary/20">
          <Phone className="size-10 text-primary animate-pulse" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{partnerLabel}</h2>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          {status === "dialing" && "Calling (Ultra-Low Data)..."}
          {status === "incoming" && "Incoming Voice Call..."}
          {status === "connected" && formatCallTime(seconds)}
          {status === "ended" && "Call Ended"}
        </p>

        <div className="mt-4 flex items-center gap-1.5 rounded-full bg-secondary/80 px-3.5 py-1 text-xs font-medium text-secondary-foreground">
          <Wifi className="size-3.5 text-primary" />
          <span>
            {status === "connected"
              ? `${dataUsedMB} MB used (Opus 16kbps HD)`
              : "~7.2 MB per hour (95% cheaper than cellular calls)"}
          </span>
        </div>
      </div>

      <div className="mb-12 w-full max-w-xs">
        {status === "incoming" ? (
          <div className="flex items-center justify-around gap-6">
            <button
              type="button"
              aria-label="Decline call"
              onClick={() => endCall(true)}
              className="flex size-16 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg active:scale-95 transition-transform"
            >
              <PhoneOff className="size-7" />
            </button>
            <button
              type="button"
              aria-label="Accept call"
              onClick={() => void acceptCall()}
              className="flex size-16 items-center justify-center rounded-full bg-green-500 text-white shadow-lg active:scale-95 transition-transform"
            >
              <Phone className="size-7" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            <div className="flex items-center justify-center gap-6">
              <button
                type="button"
                aria-label={muted ? "Unmute" : "Mute"}
                onClick={toggleMute}
                className={`flex size-14 items-center justify-center rounded-full border transition-all active:scale-95 ${
                  muted ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"
                }`}
              >
                {muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
              </button>
              <button
                type="button"
                aria-label={speakerMuted ? "Unmute speaker" : "Mute speaker"}
                onClick={toggleSpeaker}
                className={`flex size-14 items-center justify-center rounded-full border transition-all active:scale-95 ${
                  speakerMuted ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"
                }`}
              >
                {speakerMuted ? <VolumeX className="size-6" /> : <Volume2 className="size-6" />}
              </button>
            </div>

            <button
              type="button"
              aria-label="End call"
              onClick={() => endCall(true)}
              className="flex size-16 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg active:scale-95 transition-transform"
            >
              <PhoneOff className="size-7" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
      }
