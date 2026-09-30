import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createAnnotatedPdf } from "../app/annotatedPdf.mts";
import { getAnnotationLabelLayout } from "../app/annotationLabel.mts";

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
  globalThis.document = {
    createElement: (tag) => {
      assert.equal(tag, "canvas");
      return {
        getContext: () => ({
          measureText: () => ({ width: 36 }),
          scale: () => {},
          fillText: (text) => renderedLabels.push(text),
        }),
        toDataURL: () => transparentPng,
      };
    },
  };

  try {
    return await callback(renderedLabels);
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
