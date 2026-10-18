import assert from "node:assert/strict";
import test from "node:test";

import {
  VOICE_LANG,
  getSpeechRecognitionCtor,
  getSpeechSynthesisSupport,
  joinTranscript,
  mapRecognitionError,
  pickPortugueseVoice,
  textForSpeech,
} from "./voice.js";

test("uses pt-BR", () => {
  assert.equal(VOICE_LANG, "pt-BR");
});

test("detects standard, webkit-prefixed (iPhone/Safari) and missing recognition", () => {
  class A {}
  class B {}
  assert.equal(getSpeechRecognitionCtor({ SpeechRecognition: A, webkitSpeechRecognition: B }), A);
  assert.equal(getSpeechRecognitionCtor({ webkitSpeechRecognition: B }), B);
  assert.equal(getSpeechRecognitionCtor({}), null);
});

test("detects speech synthesis support", () => {
  assert.equal(getSpeechSynthesisSupport({ speechSynthesis: {}, SpeechSynthesisUtterance: class {} }), true);
  assert.equal(getSpeechSynthesisSupport({ speechSynthesis: {} }), false);
  assert.equal(getSpeechSynthesisSupport({}), false);
});

test("maps permission, microphone, network and unknown errors; ignores user aborts", () => {
  assert.match(mapRecognitionError("not-allowed"), /Permissão do microfone negada/);
  assert.match(mapRecognitionError("service-not-allowed"), /bloqueou/);
  assert.match(mapRecognitionError("audio-capture"), /Nenhum microfone/);
  assert.match(mapRecognitionError("no-speech"), /Não ouvi/);
  assert.match(mapRecognitionError("network"), /conexão/);
  assert.match(mapRecognitionError("algo-novo"), /Não foi possível/);
  assert.equal(mapRecognitionError("aborted"), "");
});

test("joins interim and final results into clean text", () => {
  const results = [[{ transcript: " quem devo " }], [{ transcript: "cobrar   hoje " }]];
  assert.equal(joinTranscript(results), "quem devo cobrar hoje");
  assert.equal(joinTranscript(undefined), "");
  assert.equal(joinTranscript([[]]), "");
});

test("prefers pt-BR, then any Portuguese voice, else none", () => {
  const voices = [
    { lang: "en-US", name: "en" },
    { lang: "pt_PT", name: "pt" },
    { lang: "pt_BR", name: "br" },
  ];
  assert.equal(pickPortugueseVoice(voices).name, "br");
  assert.equal(pickPortugueseVoice(voices.slice(0, 2)).name, "pt");
  assert.equal(pickPortugueseVoice([voices[0]]), null);
  assert.equal(pickPortugueseVoice(), null);
});

test("prepares answers for speech without symbols or emojis and caps length", () => {
  const text = "📌 **Total:** R$ 1.500,00\n• Ana — Xinguara";
  const spoken = textForSpeech(text);
  assert.ok(!/[*📌•]/u.test(spoken));
  assert.ok(spoken.includes("R$ 1.500,00"));
  assert.equal(textForSpeech("a".repeat(5000)).length, 1500);
  assert.equal(textForSpeech(null), "");
});
