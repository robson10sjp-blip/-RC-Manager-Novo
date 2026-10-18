import { useCallback, useEffect, useRef, useState } from "react";
import {
  UNSUPPORTED_RECOGNITION_MESSAGE,
  VOICE_LANG,
  getSpeechRecognitionCtor,
  getSpeechSynthesisSupport,
  joinTranscript,
  mapRecognitionError,
  pickPortugueseVoice,
  textForSpeech,
} from "../services/voice.js";

// Reconhecimento feito pelo navegador; nenhum áudio é gravado ou enviado pelo app.
export function useSpeechRecognition({ onTranscript }) {
  const [status, setStatus] = useState("idle"); // idle | listening | processing
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const callbackRef = useRef(onTranscript);
  const supported = Boolean(getSpeechRecognitionCtor());

  useEffect(() => {
    callbackRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort?.();
      recognitionRef.current = null;
    },
    []
  );

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      setStatus("processing");
      recognitionRef.current.stop();
    }
  }, []);

  const start = useCallback(() => {
    const Recognition = getSpeechRecognitionCtor();
    if (!Recognition) {
      setError(UNSUPPORTED_RECOGNITION_MESSAGE);
      return;
    }
    setError("");

    const recognition = new Recognition();
    recognition.lang = VOICE_LANG;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setStatus("listening");
    recognition.onresult = (event) => {
      const text = joinTranscript(event.results);
      if (text) callbackRef.current?.(text);
    };
    recognition.onerror = (event) => {
      const message = mapRecognitionError(event.error);
      if (message) setError(message);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setStatus("idle");
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setStatus("idle");
      setError("Não foi possível iniciar o microfone. Tente novamente.");
    }
  }, []);

  return { supported, status, error, start, stop, clearError: () => setError("") };
}

export function useSpeechSynthesis() {
  const supported = getSpeechSynthesisSupport();
  const [speakingId, setSpeakingId] = useState(null);
  const [error, setError] = useState("");

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, [supported]);

  useEffect(
    () => () => {
      if (getSpeechSynthesisSupport()) window.speechSynthesis.cancel();
    },
    []
  );

  const speak = useCallback(
    (id, text) => {
      if (!supported) return;
      const content = textForSpeech(text);
      if (!content) return;
      setError("");
      window.speechSynthesis.cancel();

      const utterance = new window.SpeechSynthesisUtterance(content);
      utterance.lang = VOICE_LANG;
      const voice = pickPortugueseVoice(window.speechSynthesis.getVoices());
      if (voice) utterance.voice = voice;
      utterance.onend = () => setSpeakingId((current) => (current === id ? null : current));
      utterance.onerror = (event) => {
        setSpeakingId((current) => (current === id ? null : current));
        if (event.error && !["canceled", "interrupted"].includes(event.error)) {
          setError("Não foi possível reproduzir a resposta em voz alta.");
        }
      };
      setSpeakingId(id);
      window.speechSynthesis.speak(utterance);
    },
    [supported]
  );

  return { supported, speakingId, error, speak, stop };
}
