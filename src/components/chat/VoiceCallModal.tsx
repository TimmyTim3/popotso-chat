import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX, Wifi, Circle, Download, Trash2 } from "lucide-react";
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

type CallStatus = "connecting" | "ringing" | "incoming" | "connected" | "ended";

export function VoiceCallModal({
  myId,
  myEmail,
  partnerEmail,
  channel,
  incomingCall,
  onClose,
}: VoiceCallModalProps) {
  const isCaller = !incomingCall;
  const [status, setStatus] = useState<CallStatus>(isCaller ? "connecting" : "incoming");
  const [muted, setMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const mixedStreamRef = useRef<MediaStream | null>(null);

  const partnerLabel = MEMBERS[partnerEmail] ?? "Family";

  // Proper intermittent phone-style ringtone (tone-silence pattern)
  const startRingtone = useCallback(() => {
    stopRingtone(); // safety
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 440;
      gain.gain.value = 0; // start silent
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      oscRef.current = osc;
      gainRef.current = gain;

      // Classic ring pattern: 1s on, 2s off
      let on = false;
      const pulse = () => {
        if (!gainRef.current || !audioCtxRef.current) return;
        on = !on;
        const now = audioCtxRef.current.currentTime;
        gainRef.current.gain.cancelScheduledValues(now);
        gainRef.current.gain.setValueAtTime(on ? 0.12 : 0, now);
      };
      pulse(); // first pulse
      ringIntervalRef.current = setInterval(pulse, 1000);
    } catch {
      // autoplay / permission restriction – silent fail
    }
  }, []);

  const stopRingtone = useCallback(() => {
    try {
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
      if (oscRef.current) {
        oscRef.current.stop();
        oscRef.current.disconnect();
        oscRef.current = null;
      }
      if (gainRef.current) {
        gainRef.current.disconnect();
        gainRef.current = null;
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    } catch {
      // ignore cleanup errors
    }
  }, []);

  // Clamp SDP to 16 kbps mono Opus for ultra-low data
  const applyLowBitrateSDP = (sdp: string) =>
    sdp.replace(
      /a=mid:audio\r\n/gi,
      "a=mid:audio\r\na=fmtp:111 minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=16000\r\n",
    );

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const endCall = useCallback(
    (notify = true) => {
      // 1. Stop everything audio-related
      stopRingtone();
      stopRecording();

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      // 2. Stop all media tracks
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current?.getTracks().forEach((t) => t.stop());
      mixedStreamRef.current?.getTracks().forEach((t) => t.stop());

      // 3. Close peer connection
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }

      localStreamRef.current = null;
      remoteStreamRef.current = null;
      mixedStreamRef.current = null;

      if (notify) {
        void channel.send({
          type: "broadcast",
          event: "call-hangup",
          payload: { from: myId },
        });
      }

      setStatus("ended");
      // Keep the modal open a moment if there is a recording so the user can save it
      if (!recordingBlob) {
        setTimeout(() => onClose(), 900);
      }
    },
    [channel, myId, onClose, stopRingtone, stopRecording, recordingBlob],
  );

  const startRecording = useCallback(async () => {
    if (!localStreamRef.current) return;

    try {
      // Mix local + remote into one stream for recording
      const mixed = new MediaStream();
      localStreamRef.current.getAudioTracks().forEach((t) => mixed.addTrack(t));
      if (remoteStreamRef.current) {
        remoteStreamRef.current.getAudioTracks().forEach((t) => mixed.addTrack(t));
      }
      mixedStreamRef.current = mixed;

      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(mixed, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        setRecordingBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordingUrl(url);
        setIsRecording(false);
      };

      recorder.start(1000); // collect every second
      setIsRecording(true);
      haptic("medium");
    } catch (err) {
      console.error("Recording failed", err);
      setIsRecording(false);
    }
  }, []);

  const saveRecordingToPhone = () => {
    if (!recordingBlob || !recordingUrl) return;
    const a = document.createElement("a");
    a.href = recordingUrl;
    a.download = `popotso-call-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    haptic("success");
  };

  const deleteRecording = () => {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingBlob(null);
    setRecordingUrl(null);
    haptic("light");
    // Now that recording is gone we can close the modal
    setTimeout(() => onClose(), 300);
  };

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
      remoteStreamRef.current = event.streams[0] ?? null;
      if (remoteAudioRef.current && event.streams[0]) {
        remoteAudioRef.current.srcObject = event.streams[0];
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
      video: false,
    });
    localStreamRef.current = stream;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    return pc;
  }, [channel, myId, stopRingtone]);

  // Caller flow
  useEffect(() => {
    if (!isCaller) return;

    setStatus("connecting");
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

        // Offer is out → now we are ringing the other side
        setStatus("ringing");
      } catch {
        endCall(true);
      }
    })();

    return () => {
      // cleanup if component unmounts while still dialing
      stopRingtone();
    };
  }, [endCall, isCaller, myEmail, myId, setupPeerConnection, startRingtone, stopRingtone, channel]);

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
      // Supabase Realtime does not expose a clean off() for every listener in all versions,
      // but the component unmount will stop everything via endCall / stopRingtone.
    };
  }, [channel, endCall, myId, status, stopRingtone]);

  // Hard cleanup on unmount
  useEffect(() => {
    return () => {
      stopRingtone();
      stopRecording();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  }, [stopRingtone, stopRecording, recordingUrl]);

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
    return `\( {mins}: \){secs.toString().padStart(2, "0")}`;
  };

  const dataUsedMB = ((seconds * 2) / 1024).toFixed(2);

  const statusText =
    status === "connecting"
      ? "Connecting..."
      : status === "ringing"
        ? "Ringing..."
        : status === "incoming"
          ? "Incoming Voice Call..."
          : status === "connected"
            ? formatCallTime(seconds)
            : "Call Ended";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-background/95 p-6 backdrop-blur-2xl animate-fade-up">
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="mt-12 flex flex-col items-center text-center">
        <div className="mb-4 flex size-24 items-center justify-center rounded-full bg-primary/10 ring-4 ring-primary/20">
          <Phone className={`size-10 text-primary ${status === "ringing" || status === "incoming" ? "animate-pulse" : ""}`} />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{partnerLabel}</h2>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{statusText}</p>

        <div className="mt-4 flex items-center gap-1.5 rounded-full bg-secondary/80 px-3.5 py-1 text-xs font-medium text-secondary-foreground">
          <Wifi className="size-3.5 text-primary" />
          <span>
            {status === "connected"
              ? `${dataUsedMB} MB used (Opus 16kbps HD)`
              : "\~7.2 MB per hour (95% cheaper than cellular calls)"}
          </span>
        </div>
      </div>

      {/* Recording result panel (shown after call ends) */}
      {status === "ended" && recordingBlob && (
        <div className="mb-6 w-full max-w-xs rounded-2xl border bg-card p-4 shadow-lg">
          <p className="mb-3 text-center text-sm font-medium">Call recording ready</p>
          <audio controls src={recordingUrl ?? undefined} className="mb-3 w-full" />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={saveRecordingToPhone}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground"
            >
              <Download className="size-4" />
              Save to phone
            </button>
            <button
              type="button"
              onClick={deleteRecording}
              className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm"
            >
              <Trash2 className="size-4" />
              Delete
            </button>
          </div>
        </div>
      )}

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
        ) : status === "ended" && !recordingBlob ? (
          <p className="text-center text-sm text-muted-foreground">Closing…</p>
        ) : (
          <div className="flex flex-col items-center gap-6">
            {status === "connected" && (
              <div className="flex items-center justify-center gap-5">
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
                  aria-label={isRecording ? "Stop recording" : "Start recording"}
                  onClick={() => (isRecording ? stopRecording() : void startRecording())}
                  className={`flex size-14 items-center justify-center rounded-full border transition-all active:scale-95 ${
                    isRecording
                      ? "border-red-500 bg-red-500 text-white animate-pulse"
                      : "border-border bg-card text-foreground"
                  }`}
                >
                  <Circle className={`size-6 ${isRecording ? "fill-current" : ""}`} />
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
            )}

            {(status === "connecting" || status === "ringing" || status === "connected") && (
              <button
                type="button"
                aria-label="End call"
                onClick={() => endCall(true)}
                className="flex size-16 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg active:scale-95 transition-transform"
              >
                <PhoneOff className="size-7" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
          }
