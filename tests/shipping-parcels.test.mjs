import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  emptyDraft,
  SHIPPING_BOX_DIMENSION_MAX_CM,
} from "../supabase/functions/_shared/shipping-domain.ts";
import * as domain from "../supabase/functions/_shared/shipping-domain.ts";

const compiled = ts.transpileModule(
  readFileSync(new URL("../frontend/src/components/shipping/ShippingParcels.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;

const words = {
  parcel: "Parcel",
  parcelBeforeCarrier: "Parcel instructions",
  parcelTotal: "Parcel count",
  box: "Box",
  copyPreviousBox: "Copy previous",
  box_width: "Width",
  box_height: "Height",
  box_length: "Length",
  box_weight: "Weight",
  boxDimensionLimit: "Dimensions must be no more than 180 cm.",
  boxWeightInvalid: "Weight must be greater than 0.",
  parcelTotalHint: "Labels are numbered automatically",
};

function render(draft, onChange = () => {}) {
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "lucide-react") return { Copy: "Copy" };
      if (name === "@/i18n") return { useLanguage: () => ({ t: { shipping: words } }) };
      if (name === "@/components/ui/button") return { Button: "Button" };
      if (name === "@/components/ui/input") return { Input: "Input" };
      if (name.endsWith("/shipping-domain")) return domain;
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return exports.default({ draft, onChange });
}

function nodes(value, result = []) {
  if (Array.isArray(value)) value.forEach((child) => nodes(child, result));
  else if (value && typeof value === "object") {
    if ("type" in value && value.props) result.push(value);
    for (const child of Object.values(value.props ?? {}))
      if (typeof child === "object") nodes(child, result);
  }
  return result;
}

test("parcel inputs use width-length-height order and show kilograms without changing stored grams", () => {
  const draft = emptyDraft();
  draft.box_length = SHIPPING_BOX_DIMENSION_MAX_CM + 1;
  draft.box_weight = 580;
  let changed;
  const rendered = nodes(render(draft, (parcels) => { changed = parcels; }));
  const inputs = rendered.filter((node) => node.type === "Input");
  const dimensions = inputs.filter((node) => ["Width", "Height", "Length"].some((label) =>
    node.props["aria-label"]?.startsWith(label)
  ));
  const weight = inputs.find((node) => node.props["aria-label"]?.startsWith("Weight"));

  assert.equal(dimensions.length, 3);
  assert.deepEqual(inputs.slice(1).map((input) => input.props["aria-label"]), [
    "Width Box 1",
    "Length Box 1",
    "Height Box 1",
    "Weight Box 1",
  ]);
  assert.ok(dimensions.every((input) => input.props.max === SHIPPING_BOX_DIMENSION_MAX_CM));
  assert.equal(weight.props.min, "0.01");
  assert.equal(weight.props.max, 1000);
  assert.equal(weight.props.step, "0.01");
  assert.equal(weight.props.value, 0.58);
  weight.props.onChange({ target: { value: "1.55" } });
  assert.equal(changed[0].box_weight, 1550);
  weight.props.onChange({ target: { value: "1.555" } });
  assert.equal(changed[0].box_weight, 1560);
  assert.equal(dimensions.find((input) => input.props["aria-label"].startsWith("Length")).props["aria-invalid"], true);
  assert.ok(rendered.some((node) => node.props?.role === "alert" && node.props.children === words.boxDimensionLimit));
});
