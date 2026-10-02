export function explorerDisplayName(name: string, limit = 42) {
  const graphemes = Array.from(
    new Intl.Segmenter("th", { granularity: "grapheme" }).segment(name),
    (part) => part.segment,
  );
  if (graphemes.length <= limit) return name;
  const headLength = Math.ceil((limit - 1) * 0.56);
  const tailLength = limit - headLength - 1;
  return `${graphemes.slice(0, headLength).join("")}…${graphemes.slice(-tailLength).join("")}`;
}
