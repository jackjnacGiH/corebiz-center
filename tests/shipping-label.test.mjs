import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as domain from "../supabase/functions/_shared/shipping-domain.ts";

const compiled = ts.transpileModule(
  readFileSync(new URL("../frontend/src/components/shipping/ShippingLabel.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText;

function jsx(type, props) {
  return typeof type === "function" ? type(props) : { type, props };
}

function render(shipment) {
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react") return {
        useEffect() {},
        useRef: (value) => ({ current: value }),
        useState: (value) => [value, () => {}],
      };
      if (name === "jsbarcode") return () => {};
      if (name === "@/lib/shipping-carriers") return {
        shippingCarrierBrand: () => ({ name: "Flash Express", shortName: "FLASH", accent: "#f6a800", logoUrl: "" }),
      };
      if (name === "@/assets/line-add-jnac.jpg") return "line-qr.jpg";
      if (name === "@/assets/shipping/jnac-logo.png") return "jnac-logo.png";
      if (name.endsWith("/shipping-domain")) return domain;
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return exports.default({ shipment, companyName: "J NAC" });
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

function textOf(value) {
  if (value == null || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  return textOf(value.props?.children);
}

test("each label shows its own width-length-height and packed weight in kilograms", () => {
  const address = {
    fullname: "ผู้ติดต่อ",
    company: "บริษัททดสอบ",
    address: "1 ถนนทดสอบ",
    county: "บางนา",
    city: "บางนา",
    state: "กรุงเทพมหานคร",
    postcode: "10260",
    email: "",
    telephone1: "0800161700",
  };
  const shipment = {
    reference_no: "SHP-TEST",
    tracking_number: "TH123456789",
    order_code: "SO-TEST",
    draft: {
      ...domain.emptyDraft(),
      origin: address,
      destination: address,
      carrier_code: "FLASH",
      products: [{ name: "สินค้า", code: "SKU-1", qty: 1, price: "0.00", weight: 0 }],
      parcel_total: 2,
      parcels: [
        { box_width: 20, box_length: 29, box_height: 15, box_weight: 580 },
        { box_width: 30, box_length: 40, box_height: 25, box_weight: 1550 },
      ],
    },
  };

  const articles = nodes(render(shipment)).filter((node) => node.type === "article");
  assert.equal(articles.length, 2);
  assert.match(textOf(articles[0]), /20 × 29 × 15 ซม\./);
  assert.match(textOf(articles[0]), /0\.58 Kg\./);
  assert.match(textOf(articles[1]), /30 × 40 × 25 ซม\./);
  assert.match(textOf(articles[1]), /1\.55 Kg\./);
  assert.ok(nodes(articles[0]).some((node) => node.props?.["data-testid"] === "shipping-label-parcel-metrics"));
});
