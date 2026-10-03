import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createAnnotatedPdf } from "../app/annotatedPdf.mts";
import {
  findAutomaticAnnotationLabelPosition,
  getAnnotationLabelConnector,
  getAnnotationLabelLayout,
} from "../app/annotationLabel.mts";

const transparentPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+X6ixAAAAAElFTkSuQmCC";

async function makeSourceFile() {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 300]);
  return new File([await pdf.save()], "synthetic.pdf", {
    type: "application/pdf",
  });
}

function annotation(requirementNo) {
  return {
    requirementNo,
    mark: {
      id: "synthetic-mark",
      side: "catalog",
      fileName: "synthetic.pdf",
      page: 1,
      text: "Synthetic area",
      area: { x: 0.2, y: 0.2, width: 0.3, height: 0.1 },
      annotation: { x: 0.2, y: 0.2 },
    },
    anchor: { x: 0.2, y: 0.2 },
  };
}

async function withCanvas(callback) {
  const originalDocument = globalThis.document;
  const renderedLabels = [];
  const paintedBackgrounds = [];
  const renderedFonts = [];
  globalThis.document = {
    createElement: (tag) => {
      assert.equal(tag, "canvas");
      return {
        getContext: () => ({
          measureText: () => ({ width: 36 }),
          scale: () => {},
          fillRect: (...args) => paintedBackgrounds.push(["fill", ...args]),
          strokeRect: (...args) => paintedBackgrounds.push(["stroke", ...args]),
          fillText(text) { renderedLabels.push(text); renderedFonts.push(this.font); },
        }),
        toDataURL: () => transparentPng,
      };
    },
  };

  try {
    return await callback(renderedLabels, paintedBackgrounds, renderedFonts);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
}

test("exports an ASCII annotation with the standard PDF font", async () => {
  await withCanvas(async () => {
    const output = await createAnnotatedPdf(
      await makeSourceFile(),
      [annotation("4.1.5")],
    );
    assert.equal(output.type, "application/pdf");
    assert.equal((await PDFDocument.load(await output.arrayBuffer())).getPageCount(), 1);
  });
});

test("exports a Thai-numbered annotation without WinAnsi encoding errors", async () => {
  await withCanvas(async (renderedLabels) => {
    const output = await createAnnotatedPdf(
      await makeSourceFile(),
      [annotation("๔.๑.๕")],
    );
    assert.deepEqual(renderedLabels, ["#๔.๑.๕"]);
    assert.equal((await PDFDocument.load(await output.arrayBuffer())).getPageCount(), 1);
  });
});

test("exports a shared highlight with independently colored links", async () => {
  await withCanvas(async () => {
    const output = await createAnnotatedPdf(
      await makeSourceFile(),
      [{ ...annotation("1 · #2"), colors: ["rose", "teal"] }],
    );
    assert.equal((await PDFDocument.load(await output.arrayBuffer())).getPageCount(), 1);
  });
});

test("exports placed Thai Requirement text without a background or frame", async () => {
  await withCanvas(async (renderedText, paintedBackgrounds) => {
    const output = await createAnnotatedPdf(
      await makeSourceFile(),
      [],
      undefined,
      [{ id: "stamp", rowId: "row", documentId: "doc", page: 1, x: 0.3, y: 0.4, text: "ลำโพง 12 นิ้ว" }],
    );
    assert.deepEqual(renderedText, ["ลำโพง 12 นิ้ว"]);
    assert.deepEqual(paintedBackgrounds, []);
    assert.equal((await PDFDocument.load(await output.arrayBuffer())).getPageCount(), 1);
  });
});

test("exports a resized Requirement with the stored text size", async () => {
  await withCanvas(async (_, __, renderedFonts) => {
    const output = await createAnnotatedPdf(
      await makeSourceFile(), [], undefined,
      [{ id: "stamp", rowId: "row", documentId: "doc", page: 1, x: 0.2, y: 0.3, text: "ทดสอบ", scale: 2 }],
    );
    assert.ok(Math.abs(Number.parseFloat(renderedFonts[0]) - 13.6) < 0.001);
    assert.equal((await PDFDocument.load(await output.arrayBuffer())).getPageCount(), 1);
  });
});

test("label layout uses the same normalized position at screen and PDF sizes", () => {
  const placement = {
    anchor: { x: 0.7, y: 0.4 },
    position: { x: 0.53, y: 0.35 },
  };
  const screen = getAnnotationLabelLayout({
    ...placement,
    pageWidth: 1000,
    pageHeight: 1400,
    textWidth: 90,
  });
  const pdf = getAnnotationLabelLayout({
    ...placement,
    pageWidth: 500,
    pageHeight: 700,
    textWidth: 45,
  });

  assert.equal(screen.x / 1000, pdf.x / 500);
  assert.equal(screen.y / 1400, pdf.y / 700);
  assert.equal(screen.width / 1000, pdf.width / 500);
  assert.equal(screen.height / 1400, pdf.height / 700);
  assert.equal(screen.homeX / 1000, pdf.homeX / 500);
  assert.equal(screen.homeY / 1400, pdf.homeY / 700);
});

test("default badge touches the left border of its highlight", () => {
  const layout = getAnnotationLabelLayout({
    pageWidth: 400,
    pageHeight: 500,
    textWidth: 24,
    anchor: { x: 0.4, y: 0.3 },
  });
  assert.equal(layout.x + layout.width, 160);
  assert.equal(layout.y, 150);
  assert.equal(getAnnotationLabelConnector(
    { x: layout.x, y: layout.y, width: layout.width, height: layout.height },
    { x: 160, y: 150, width: 90, height: 30 },
  ), null);
});

test("a displaced badge connects to its highlight border", () => {
  assert.deepEqual(getAnnotationLabelConnector(
    { x: 50, y: 80, width: 30, height: 16 },
    { x: 100, y: 80, width: 90, height: 30 },
  ), {
    start: { x: 80, y: 95 },
    end: { x: 100, y: 95 },
  });
});

test("automatic badge attaches to another edge when the left page edge is crowded", () => {
  const placement = findAutomaticAnnotationLabelPosition({
    pageWidth: 400,
    pageHeight: 400,
    labelWidth: 30,
    labelHeight: 16,
    anchor: { x: 4, y: 100, width: 40, height: 25 },
    obstacles: [{ x: 0, y: 100, width: 44, height: 25 }],
    occupied: [],
  });
  assert.deepEqual(placement, { x: 4, y: 84 });
  assert.equal(getAnnotationLabelConnector(
    { ...placement, width: 30, height: 16 },
    { x: 4, y: 100, width: 40, height: 25 },
  ), null);
});

test("automatic label placement moves out of a heading and stays near its highlight", () => {
  const placement = findAutomaticAnnotationLabelPosition({
    pageWidth: 300,
    pageHeight: 400,
    labelWidth: 30,
    labelHeight: 16,
    anchor: { x: 100, y: 100, width: 120, height: 50 },
    obstacles: [
      { x: 98, y: 79, width: 150, height: 22 },
      { x: 100, y: 100, width: 120, height: 50 },
    ],
    occupied: [],
  });
  assert.ok(placement.x < 100);
  assert.ok(placement.y >= 0);
});

test("automatic label placement avoids another badge and rendered ink", () => {
  const placement = findAutomaticAnnotationLabelPosition({
    pageWidth: 400,
    pageHeight: 400,
    labelWidth: 30,
    labelHeight: 16,
    anchor: { x: 120, y: 120, width: 40, height: 25 },
    obstacles: [{ x: 120, y: 101, width: 45, height: 20 }],
    occupied: [{ x: 85, y: 115, width: 35, height: 25 }],
    inkFraction: (rect) => rect.x === 120 && rect.y === 104 ? 1 : 0,
  });
  assert.ok(placement.x >= 0 && placement.x + 30 <= 400);
  assert.ok(placement.y >= 0 && placement.y + 16 <= 400);
  assert.notDeepEqual(placement, { x: 120, y: 104 });
  assert.ok(placement.x >= 120 || placement.y >= 140);
});

test("label offsets remain proportional when a badge was moved", () => {
  const placement = {
    anchor: { x: 0.7, y: 0.4 },
    offset: { x: -0.08, y: 0.03 },
  };
  const screen = getAnnotationLabelLayout({
    ...placement,
    pageWidth: 1000,
    pageHeight: 1400,
    textWidth: 90,
  });
  const pdf = getAnnotationLabelLayout({
    ...placement,
    pageWidth: 500,
    pageHeight: 700,
    textWidth: 45,
  });

  assert.equal(screen.x / 1000, pdf.x / 500);
  assert.equal(screen.y / 1400, pdf.y / 700);
  assert.equal(screen.width / 1000, pdf.width / 500);
  assert.equal(screen.height / 1400, pdf.height / 700);
});
