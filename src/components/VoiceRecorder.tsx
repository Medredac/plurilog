'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Square, Loader2 } from 'lucide-react';

interface VoiceRecorderProps {
  onTranscript: (text: string) => void;
  onCancel: () => void;
  onError: (errorMessage: string) => void;
}

const MAX_RECORDING_SECONDS = 120; // 2 minutes max
const BAR_COUNT = 16;

function getSupportedMimeType(): { mimeType: string } {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/wav',
  ];

  if (typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined') {
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) {
        return { mimeType: mime };
      }
    }
  }
  return { mimeType: '' };
}

export function getExtensionForMime(mime: string): string {
  const base = mime.toLowerCase().split(';')[0].trim();
  switch (base) {
    case 'audio/mp4':
      return 'mp4';
    case 'audio/m4a':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/ogg':
    case 'audio/vorbis':
      return 'ogg';
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/webm':
    default:
      return 'webm';
  }
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onTranscript,
  onCancel,
  onError,
}) => {
  const [seconds, setSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isRecorderReady, setIsRecorderReady] = useState(false);

  const recorderReadyRef = useRef<boolean>(false);
  const elapsedSecondsRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isCanceledRef = useRef<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  const cleanupAudio = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    isCanceledRef.current = true;
    recorderReadyRef.current = false;
    setIsRecorderReady(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    chunksRef.current = [];
    cleanupAudio();
    onCancel();
  }, [cleanupAudio, onCancel]);

  const handleStopRecording = useCallback(() => {
    if (!recorderReadyRef.current) {
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return;
    }

    recorderReadyRef.current = false;
    setIsRecorderReady(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      recorder.stop();
    } catch (err) {
      console.error('Failed to stop media recorder:', err);
      cleanupAudio();
      setIsTranscribing(false);
      onError('Failed to stop recording.');
      onCancel();
      return;
    }

    // Release stream tracks and visualization immediately after stop() is invoked
    cleanupAudio();
    setIsTranscribing(true);
  }, [cleanupAudio, onCancel, onError]);

  // Start recording on mount
  useEffect(() => {
    let mounted = true;
    isCanceledRef.current = false;
    recorderReadyRef.current = false;
    setIsRecorderReady(false);

    const startRecording = async () => {
      try {
        if (
          typeof window === 'undefined' ||
          typeof window.MediaRecorder === 'undefined' ||
          !navigator?.mediaDevices?.getUserMedia
        ) {
          onError('Audio recording is not supported in this browser.');
          onCancel();
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!mounted || isCanceledRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        // Visualizer setup (isolated so visualizer failure never blocks recording)
        try {
          const AudioContextClass =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (AudioContextClass) {
            const audioCtx = new AudioContextClass();
            if (audioCtx.state === 'suspended') {
              audioCtx.resume().catch(() => {});
            }
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.8;
            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);

            audioContextRef.current = audioCtx;
            analyserRef.current = analyser;

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateBars = () => {
              if (!analyserRef.current) return;
              analyserRef.current.getByteFrequencyData(dataArray);

              // Update DOM bar heights directly without triggering React re-renders
              const step = Math.floor(dataArray.length / BAR_COUNT);
              for (let i = 0; i < BAR_COUNT; i++) {
                const val = dataArray[i * step] || 0;
                // Map 0..255 to 4px..28px height
                const height = Math.max(4, Math.min(28, 4 + (val / 255) * 24));
                const el = barRefs.current[i];
                if (el) {
                  el.style.height = `${height}px`;
                }
              }
              animationFrameRef.current = requestAnimationFrame(updateBars);
            };
            updateBars();
          }
        } catch (visualizerErr) {
          console.warn(
            '[VoiceRecorder] Audio visualizer setup failed, recording will proceed without visualizer:',
            visualizerErr
          );
        }

        // Set up MediaRecorder
        const { mimeType } = getSupportedMimeType();
        const options: MediaRecorderOptions = {};
        if (mimeType) {
          options.mimeType = mimeType;
        }

        const recorder = new MediaRecorder(stream, options);
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        recorder.onstop = async () => {
          if (isCanceledRef.current) return;

          const rawChunks = chunksRef.current;
          if (rawChunks.length === 0) {
            onError('No audio was captured.');
            onCancel();
            return;
          }

          const finalMime =
            recorder.mimeType ||
            rawChunks.find((chunk) => chunk.type)?.type ||
            mimeType ||
            'audio/webm';

          const extension = getExtensionForMime(finalMime);
          const audioBlob = new Blob(rawChunks, { type: finalMime });

          if (audioBlob.size === 0) {
            onError('Recorded audio is empty.');
            onCancel();
            return;
          }

          // Upload to /api/transcribe
          const controller = new AbortController();
          abortControllerRef.current = controller;

          try {
            const formData = new FormData();
            formData.append('audio', audioBlob, `recording.${extension}`);

            const response = await fetch('/api/transcribe', {
              method: 'POST',
              body: formData,
              signal: controller.signal,
            });

            if (isCanceledRef.current) return;

            if (!response.ok) {
              const errorPayload = await response.json().catch(() => ({}));
              throw new Error(errorPayload.error || `Server responded with ${response.status}`);
            }

            const result = await response.json();
            const transcriptText = result.text ?? '';
            onTranscript(transcriptText);
          } catch (fetchErr: any) {
            if (fetchErr.name === 'AbortError' || isCanceledRef.current) {
              return;
            }
            console.error('[Voice Transcription Error]', fetchErr);
            onError(fetchErr.message || 'Failed to transcribe audio.');
            onCancel();
          } finally {
            abortControllerRef.current = null;
          }
        };

        recorder.start(100);

        if (!mounted || isCanceledRef.current) {
          try {
            recorder.stop();
          } catch {}
          return;
        }

        recorderReadyRef.current = true;
        setIsRecorderReady(true);

        // Timer increment outside of setState updater with elapsed count ref
        elapsedSecondsRef.current = 0;
        setSeconds(0);
        timerRef.current = setInterval(() => {
          elapsedSecondsRef.current += 1;
          const currentElapsed = elapsedSecondsRef.current;
          setSeconds(currentElapsed);

          if (currentElapsed >= MAX_RECORDING_SECONDS) {
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            handleStopRecording();
          }
        }, 1000);
      } catch (err: any) {
        if (!mounted || isCanceledRef.current) return;
        recorderReadyRef.current = false;
        setIsRecorderReady(false);
        console.error('[Microphone Start Error]', err);
        let msg = 'Could not access microphone.';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          msg = 'Microphone permission denied. Please allow microphone access in your browser settings.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          msg = 'No microphone device found on your system.';
        }
        onError(msg);
        onCancel();
      }
    };

    startRecording();

    return () => {
      mounted = false;
      isCanceledRef.current = true;
      recorderReadyRef.current = false;
      setIsRecorderReady(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      chunksRef.current = [];
      cleanupAudio();
    };
  }, [cleanupAudio, handleStopRecording, onCancel, onError, onTranscript]);

  const formattedTime = `${Math.floor(seconds / 60)}:${(seconds % 60)
    .toString()
    .padStart(2, '0')}`;

  return (
    <div className="w-full flex items-center justify-between gap-2 sm:gap-3 py-1 px-1.5 min-h-[38px] select-none animate-in fade-in duration-150 min-w-0 max-w-full">
      {/* Left side: Cancel Button + Timer & Indicator */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        <button
          type="button"
          onClick={handleCancel}
          className="p-2 lg:p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 active:bg-zinc-200/70 transition-colors cursor-pointer min-h-[36px] min-w-[36px] lg:min-h-0 lg:min-w-0 flex items-center justify-center"
          title="Cancel recording"
          aria-label="Cancel recording"
        >
          <X className="w-4 h-4" />
        </button>

        {!isTranscribing && (
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div
              className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0 ${
                isRecorderReady ? 'bg-red-500 animate-pulse' : 'bg-zinc-300'
              }`}
            />
            <span className="text-xs sm:text-sm font-medium text-zinc-700 font-mono">
              {formattedTime}
            </span>
          </div>
        )}
      </div>

      {/* Center: Live Waveform Bars or Transcribing State or Starting State */}
      <div className="flex-1 flex items-center justify-center min-w-0 px-1 sm:px-2">
        {isTranscribing ? (
          <div className="flex items-center gap-2 text-xs sm:text-sm text-zinc-600 font-medium animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin text-zinc-500 shrink-0" />
            <span className="truncate">Transcribing audio...</span>
          </div>
        ) : !isRecorderReady ? (
          <div className="flex items-center gap-2 text-xs text-zinc-400 animate-pulse">
            <span className="truncate">Starting microphone...</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-0.5 lg:gap-1.5 h-7 w-full max-w-[140px] sm:max-w-[200px] lg:max-w-[240px]">
            {Array.from({ length: BAR_COUNT }).map((_, idx) => (
              <div
                key={idx}
                ref={(el) => {
                  barRefs.current[idx] = el;
                }}
                className="w-1 lg:w-1.5 bg-zinc-700 rounded-full transition-[height] duration-75 ease-out"
                style={{ height: '4px' }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right side: Stop & Transcribe Button */}
      <div className="flex items-center shrink-0">
        {isTranscribing ? (
          <button
            type="button"
            onClick={handleCancel}
            className="text-xs text-zinc-400 hover:text-zinc-600 px-2.5 py-1.5 transition-colors cursor-pointer min-h-[36px] flex items-center"
            title="Cancel transcription"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStopRecording}
            disabled={!isRecorderReady}
            className={`w-9 h-9 lg:w-8 lg:h-8 rounded-full flex items-center justify-center transition-all active:scale-95 ${
              isRecorderReady
                ? 'bg-zinc-900 hover:bg-zinc-800 text-white cursor-pointer shadow-2xs'
                : 'bg-zinc-200 text-zinc-400 cursor-not-allowed opacity-50'
            }`}
            title={isRecorderReady ? 'Stop recording and transcribe' : 'Starting microphone...'}
            aria-label="Stop recording and transcribe"
          >
            <Square className="w-3.5 h-3.5 lg:w-3 lg:h-3 fill-current" />
          </button>
        )}
      </div>
    </div>
  );
};
