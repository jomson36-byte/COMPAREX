const thaiDigitZero = "๐".charCodeAt(0);

export function toAsciiDigits(value: string) {
  return value.replace(/[๐-๙]/g, (digit) =>
    String(digit.charCodeAt(0) - thaiDigitZero),
  );
}

function formatNumberLike(value: number, reference: string) {
  const formatted = String(value);
  return /[๐-๙]/.test(reference)
    ? formatted.replace(/[0-9]/g, (digit) =>
        String.fromCharCode(thaiDigitZero + Number(digit)),
      )
    : formatted;
}

export function normalizeRequirementStartPath(value: unknown) {
  const text = String(value ?? "1").trim();
  return /^[0-9๐-๙]+(?:\.[0-9๐-๙]+)*$/.test(text) ? text : "1";
}

export function getRootRequirementPath(startPath: string, index: number) {
  const parts = normalizeRequirementStartPath(startPath).split(".");
  const last = parts.at(-1) ?? "1";
  const next = Number(toAsciiDigits(last)) + index;
  return [...parts.slice(0, -1), formatNumberLike(next, last)].join(".");
}

export function appendRequirementPath(parentPath: string, index: number) {
  const last = parentPath.split(".").at(-1) ?? "1";
  return `${parentPath}.${formatNumberLike(index, last)}`;
}

export function getParentRequirementNumber(number: string) {
  return toAsciiDigits(number.split(".").slice(0, -1).join("."));
}

export function parseNumberedRequirements(value: string) {
  const parsed: Array<{ number: string; title: string }> = [];
  const levels: Array<{ indent: number; number: string }> = [];

  value.split(/\r?\n/).forEach((rawLine) => {
    const normalizedLine = rawLine
      .replace(/\u00a0/g, " ")
      .replace(/\t/g, "  ");
    const line = normalizedLine.replace(/\*\*|__/g, "").trim();
    if (!line) return;
    const match = normalizedLine
      .replace(/\*\*|__/g, "")
      .match(/^(\s*)(?:[-•]\s+)?([0-9๐-๙]+(?:\.[0-9๐-๙]+)*)(?:[.)])?\s+(.+)$/);

    if (match) {
      const indent = match[1].length;
      const rawNumber = match[2];
      const title = match[3].trim();
      const number = rawNumber.includes(".")
        ? rawNumber
        : (() => {
            const sameLevelIndex = levels.findIndex(
              (level) => level.indent === indent,
            );
            if (sameLevelIndex >= 0) {
              levels.splice(sameLevelIndex + 1);
              levels[sameLevelIndex] = { indent, number: rawNumber };
              return levels.map((level) => level.number).join(".");
            }

            const parentIndex = [...levels]
              .map((level, index) => ({ level, index }))
              .reverse()
              .find(({ level }) => level.indent < indent)?.index;

            if (parentIndex === undefined) {
              levels.splice(0, levels.length, { indent, number: rawNumber });
              return rawNumber;
            }

            levels.splice(parentIndex + 1);
            levels.push({ indent, number: rawNumber });
            return levels.map((level) => level.number).join(".");
          })();

      parsed.push({ number, title });
      return;
    }

    const previous = parsed.at(-1);
    if (previous) previous.title = `${previous.title} ${line}`.trim();
  });
  return parsed;
}
