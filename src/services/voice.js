export const VOICE_LANG = "pt-BR";

export function getSpeechRecognitionCtor(win = globalThis) {
  return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}

export function getSpeechSynthesisSupport(win = globalThis) {
  return Boolean(win?.speechSynthesis && win?.SpeechSynthesisUtterance);
}

const RECOGNITION_ERRORS = {
  "not-allowed": "Permissão do microfone negada. Libere o microfone nas configurações do navegador.",
  "service-not-allowed": "O navegador bloqueou o reconhecimento de voz. Libere o microfone nas configurações.",
  "audio-capture": "Nenhum microfone foi encontrado neste aparelho.",
  "no-speech": "Não ouvi nada. Toque no microfone e fale novamente.",
  network: "Sem conexão para o reconhecimento de voz. Digite a pergunta.",
  "language-not-supported": "O reconhecimento de voz em português não está disponível neste navegador.",
};

// "aborted" acontece quando o próprio usuário interrompe e não deve virar erro.
export function mapRecognitionError(code) {
  if (code === "aborted") return "";
  return RECOGNITION_ERRORS[code] || "Não foi possível usar o reconhecimento de voz. Digite a pergunta.";
}

export const UNSUPPORTED_RECOGNITION_MESSAGE =
  "Este navegador não permite comando de voz. No iPhone, use o ícone de microfone do teclado para ditar, ou digite a pergunta. No computador, prefira Chrome ou Edge.";

export function joinTranscript(results) {
  return Array.from(results || [])
    .map((result) => result?.[0]?.transcript || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pickPortugueseVoice(voices = []) {
  const list = Array.from(voices);
  const normalized = (voice) => String(voice.lang || "").replace("_", "-").toLowerCase();
  return (
    list.find((voice) => normalized(voice) === "pt-br") ||
    list.find((voice) => normalized(voice).startsWith("pt")) ||
    null
  );
}

// Remove símbolos que as vozes leriam de forma estranha e limita o tamanho.
export function textForSpeech(text, maxLength = 1500) {
  return String(text || "")
    .replace(/[*_`#>|]/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[•·]/g, ", ")
    .replace(/\s*\n\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
