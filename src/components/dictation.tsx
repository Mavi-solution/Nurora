"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice-to-text using the browser's built-in SpeechRecognition.
 *
 * No external service and nothing leaves the device beyond what the
 * browser itself sends to its own speech provider — which matters for
 * session notes, since those are clinical records. Unsupported browsers
 * report `supported: false` and callers hide the button rather than
 * offering something that silently does nothing.
 *
 * `continuous` is on for notes: a counsellor writing up a session talks
 * in pauses, and the one-shot mode used by the chat composer cuts off
 * after the first sentence.
 */
export function useDictation(opts: {
  /** Called with the full text as it is recognised. */
  onText: (text: string) => void;
  /** Text already present, so dictation appends rather than replaces. */
  baseline: () => string;
  continuous?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Keep the latest callbacks without restarting recognition.
  const onTextRef = useRef(opts.onText);
  const baselineRef = useRef(opts.baseline);
  onTextRef.current = opts.onText;
  baselineRef.current = opts.baseline;

  useEffect(() => {
    const Ctor =
      typeof window !== "undefined"
        ? window.SpeechRecognition ?? window.webkitSpeechRecognition
        : undefined;
    setSupported(Boolean(Ctor));
  }, []);

  // Stop the microphone if the component goes away mid-dictation.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = navigator.language || "en-IN";
    recognition.interimResults = true;
    recognition.continuous = opts.continuous ?? false;

    const baseline = baselineRef.current();

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      const joined = baseline
        ? `${baseline.replace(/\s+$/, "")} ${transcript}`
        : transcript;
      onTextRef.current(joined.trimStart());
    };

    recognition.onerror = (event) => {
      setError(
        event.error === "not-allowed"
          ? "Microphone permission was denied."
          : event.error === "no-speech"
            ? "Didn't catch anything — try again."
            : "Dictation failed. Try typing instead.",
      );
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setError(null);
    setListening(true);
    recognition.start();
  }, [opts.continuous]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, error, toggle, start, stop, setError };
}

/** The microphone button. Hidden entirely where speech is unsupported. */
export function DictateButton({
  listening,
  onClick,
  label = "Dictate",
  className = "",
}: {
  listening: boolean;
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={listening ? "Stop dictation" : label}
      aria-pressed={listening}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] font-medium transition-colors ${
        listening
          ? "bg-red-500 border-red-500 text-white animate-pulse"
          : "border-hairline text-muted hover:text-body hover:bg-card-muted"
      } ${className}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
      {listening ? "Listening…" : label}
    </button>
  );
}

/* --- Minimal typings for the Web Speech API (not in lib.dom yet). ------- */

export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
