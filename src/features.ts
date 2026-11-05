// Turns a message into features: whole words, pairs of words and pieces of
// words (2 to 4 letters). Pieces of words let the model recognise forms it
// has not seen, which matters for Kazakh and Russian endings and for typos.

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\d{1,2}[:.]\d{2}/g, " 00:00 ")
    .replace(/\+?\d[\d\s()-]{8,}\d/g, " phone ")
    .replace(/[^\p{L}\p{N}: ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function features(text: string): string[] {
  const words = normalize(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  words.forEach((w, i) => {
    out.add(`w:${w}`);
    if (i > 0) out.add(`b:${words[i - 1]}_${w}`);
    const padded = `<${w}>`;
    if (w.length > 4) out.add(`p:${w.slice(0, 4)}`);
    for (let n = 3; n <= 5; n++) for (let j = 0; j + n <= padded.length; j++) out.add(`c:${padded.slice(j, j + n)}`);
  });
  if (!words.length) out.add("empty");
  if (words.length <= 2) out.add("short");
  return [...out];
}
