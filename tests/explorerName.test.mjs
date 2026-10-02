import assert from "node:assert/strict";
import test from "node:test";
import { explorerDisplayName } from "../app/explorerName.mts";

test("Explorer keeps the distinctive end of a long Thai PDF name visible", () => {
  const name = "บริษัท ทริปเปิ้ล อินโนเวชั่น จำกัด_เอกสารข้อมูลผลิตภัณฑ์รุ่น ZLX-12P-G2.pdf";
  const shown = explorerDisplayName(name, 38);
  assert.ok([...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(shown)].length <= 38);
  assert.ok(shown.startsWith("บริษัท"));
  assert.ok(shown.endsWith("ZLX-12P-G2.pdf"));
});

test("Explorer does not shorten readable document names", () => {
  assert.equal(explorerDisplayName("Review Table"), "Review Table");
});
