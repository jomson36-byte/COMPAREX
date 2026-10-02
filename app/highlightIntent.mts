type SelectionContext = {
  interactionMode: "highlight" | "link";
  neutralLinking: boolean;
  side: "tor" | "catalog";
  pendingLinkId: string | null;
  evidenceTargetRowId: string | null;
};

export function selectionAction(context: SelectionContext): "highlight" | "link" | "toolbar" {
  if (context.interactionMode === "link" && (context.neutralLinking || context.side === "tor")) return "link";
  if (context.interactionMode === "highlight" && context.evidenceTargetRowId) return "highlight";
  if (context.side === "catalog" && context.pendingLinkId) return "link";
  return "toolbar";
}
