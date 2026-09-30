import assert from "node:assert/strict";
import test from "node:test";
import {
  appendRequirementPath,
  getParentRequirementNumber,
  getRootRequirementPath,
  normalizeRequirementStartPath,
  parseNumberedRequirements,
  toAsciiDigits,
} from "../app/requirementNumbering.mts";

test("parses Thai, Arabic, and mixed dotted numbers without changing their display", () => {
  assert.deepEqual(
    parseNumberedRequirements(
      "๔.๑ หัวข้อหลัก\n๔.๑.๑ ข้อย่อย\n4.๑.2 Mixed digits\n4.1.3 Arabic digits",
    ),
    [
      { number: "๔.๑", title: "หัวข้อหลัก" },
      { number: "๔.๑.๑", title: "ข้อย่อย" },
      { number: "4.๑.2", title: "Mixed digits" },
      { number: "4.1.3", title: "Arabic digits" },
    ],
  );
});

test("keeps indented Thai subitems under their parent and joins continuation text", () => {
  assert.deepEqual(
    parseNumberedRequirements("๔ หัวข้อหลัก\n  ๑ ข้อย่อย\n    รายละเอียดต่อ\n  ๒ ข้อถัดไป"),
    [
      { number: "๔", title: "หัวข้อหลัก" },
      { number: "๔.๑", title: "ข้อย่อย รายละเอียดต่อ" },
      { number: "๔.๒", title: "ข้อถัดไป" },
    ],
  );
});

test("parses dash-prefixed Thai numbers copied from a TOR list", () => {
  assert.deepEqual(
    parseNumberedRequirements("รายการที่ ๔ ลำโพง\n- ๔.๑.๑ ข้อแรก\n- ๔.๑.๒ ข้อถัดไป"),
    [
      { number: "๔.๑.๑", title: "ข้อแรก" },
      { number: "๔.๑.๒", title: "ข้อถัดไป" },
    ],
  );
});

test("does not treat a รายการที่ prefix as a numbered line", () => {
  assert.deepEqual(parseNumberedRequirements("รายการที่ ๔ เครื่องเสียง"), []);
});

test("matches parent numbers across Thai and Arabic digit styles", () => {
  assert.equal(toAsciiDigits("๔.๑"), "4.1");
  assert.equal(getParentRequirementNumber("4.๑.1"), "4.1");
});

test("accepts Thai start numbers and keeps their style when counting", () => {
  assert.equal(normalizeRequirementStartPath("๔.๑.๑"), "๔.๑.๑");
  assert.equal(normalizeRequirementStartPath("๔.1.๑"), "๔.1.๑");
  assert.equal(normalizeRequirementStartPath("รายการที่ ๔"), "1");
  assert.equal(getRootRequirementPath("๔.๑.๑", 1), "๔.๑.๒");
  assert.equal(getRootRequirementPath("4.1.1", 1), "4.1.2");
  assert.equal(appendRequirementPath("๔.๑", 1), "๔.๑.๑");
});
