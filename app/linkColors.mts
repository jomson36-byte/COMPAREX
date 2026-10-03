export const linkColors = [
  { id: "blue", label: "Blue", ink: "#93c5fd", cell: "#172554", fill: "#3b82f6", badge: "#1d4ed8", rgb: [59, 130, 246] },
  { id: "teal", label: "Teal", ink: "#5eead4", cell: "#103b3b", fill: "#14b8a6", badge: "#0f766e", rgb: [20, 184, 166] },
  { id: "violet", label: "Violet", ink: "#c4b5fd", cell: "#2e2250", fill: "#8b5cf6", badge: "#6d28d9", rgb: [139, 92, 246] },
  { id: "rose", label: "Rose", ink: "#f9a8d4", cell: "#452039", fill: "#ec4899", badge: "#be185d", rgb: [236, 72, 153] },
  { id: "slate", label: "Slate", ink: "#cbd5e1", cell: "#293648", fill: "#64748b", badge: "#475569", rgb: [100, 116, 139] },
] as const;

export type LinkColor = (typeof linkColors)[number]["id"];

export function resolveLinkColor(value: unknown): LinkColor {
  return linkColors.find((item) => item.id === value)?.id ?? "blue";
}

export function columnLinkColor(colors: Readonly<Record<string, LinkColor>>, column: number): LinkColor {
  const normalizedColumn = Number.isInteger(column) && column > 0 ? column : 1;
  const saved = colors[String(normalizedColumn)];
  return linkColors.find((item) => item.id === saved)?.id ?? linkColors[(normalizedColumn - 1) % linkColors.length].id;
}

export function sanitizeColumnLinkColors(value: unknown): Record<string, LinkColor> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([column, color]) => {
    const number = Number(column);
    return Number.isInteger(number) && number > 0 && number <= 100 && linkColors.some((item) => item.id === color)
      ? [[column, color as LinkColor]]
      : [];
  }));
}

export function linkColorStyle(value: unknown) {
  return linkColors.find((item) => item.id === resolveLinkColor(value)) ?? linkColors[0];
}
