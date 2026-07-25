const MAX_CHUNK_LENGTH = 340;

export function normaliseText(input) {
  return String(input ?? "")
    .replace(/\u00ad/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLongSegment(segment, maxLength) {
  const words = segment.split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length <= maxLength) {
      current += ` ${word}`;
    } else {
      chunks.push(current);
      current = word;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function chunkText(input, maxLength = MAX_CHUNK_LENGTH) {
  const text = normaliseText(input);
  if (!text) return [];

  const paragraphs = text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const units = [];

  for (const paragraph of paragraphs) {
    const sentences = paragraph.match(/[^.!?…。？！]+(?:[.!?…。？！]+["')\]}»”’]*|$)/g) ?? [paragraph];
    for (const sentence of sentences) {
      const clean = sentence.trim();
      if (!clean) continue;
      if (clean.length <= maxLength) units.push(clean);
      else units.push(...splitLongSegment(clean, maxLength));
    }
  }

  const chunks = [];
  let current = "";

  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }

    if (`${current} ${unit}`.length <= maxLength) {
      current += ` ${unit}`;
    } else {
      chunks.push(current);
      current = unit;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
