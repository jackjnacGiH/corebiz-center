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
  parcelTotalHint: "Labels are numbered automatically",
};

function render(draft) {
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
  return exports.default({ draft, onChange() {} });
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

test("parcel inputs expose PromptSpeed's 180 cm maximum without changing the gram limit", () => {
  const draft = emptyDraft();
  draft.box_length = SHIPPING_BOX_DIMENSION_MAX_CM + 1;
  const rendered = nodes(render(draft));
  const inputs = rendered.filter((node) => node.type === "Input");
  const dimensions = inputs.filter((node) => ["Width", "Height", "Length"].some((label) =>
    node.props["aria-label"]?.startsWith(label)
  ));
  const weight = inputs.find((node) => node.props["aria-label"]?.startsWith("Weight"));

  assert.equal(dimensions.length, 3);
  assert.ok(dimensions.every((input) => input.props.max === SHIPPING_BOX_DIMENSION_MAX_CM));
  assert.equal(weight.props.max, 1000000);
  assert.equal(dimensions.find((input) => input.props["aria-label"].startsWith("Length")).props["aria-invalid"], true);
  assert.ok(rendered.some((node) => node.props?.role === "alert" && node.props.children === words.boxDimensionLimit));
});
