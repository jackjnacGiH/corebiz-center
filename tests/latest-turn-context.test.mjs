import assert from "node:assert/strict";
import test from "node:test";

import { routeLatestTurn } from "../supabase/functions/_shared/latest-turn-context.mjs";

const textOf = (history) => history.map((turn) => turn.content).join("\n");

test("a newly named product uses the latest message instead of the old XA945 topic", () => {
  const history = [
    { role: "user", content: 'จานทรายหลังอ่อน XA945 4" 46P #400 จำนวน 100 ชิ้น' },
    { role: "assistant", content: 'พบจานทรายหลังอ่อน XA945 4" #400 ค่ะ' },
  ];
  const query = 'ม้วนใยสังเคราะห์ สก๊อตไบรท์ สีแดง #400 Size 6"x10 M. ราคาเท่าไหร่';

  const route = routeLatestTurn(query, history);
  assert.equal(route.kind, "new_product");
  assert.deepEqual(route.history, []);
  assert.match(route.topicQuery ?? "", /ม้วนใยสังเคราะห์/);
  assert.doesNotMatch(route.topicQuery ?? "", /XA945/);
});

test("an adjacent size and grit reply retains only its SA331 clarification", () => {
  const history = [
    { role: "user", content: 'จานทราย XA945 4" #80' },
    { role: "assistant", content: "พบจานทรายค่ะ" },
    { role: "user", content: "สนใจกระดาษทราย DEERFOS SA331" },
    { role: "assistant", content: "รุ่นนี้ต้องการขนาดและเบอร์ความละเอียดอะไรคะ" },
  ];

  const route = routeLatestTurn('5" #1500', history);
  assert.equal(route.kind, "follow_up");
  assert.match(textOf(route.history), /SA331/);
  assert.doesNotMatch(textOf(route.history), /XA945/);
  assert.match(route.topicQuery ?? "", /SA331/);
});

test("a numbered choice is resolved against the latest catalog offer", () => {
  const history = [
    { role: "user", content: "มีจานทราย XA945 ไหมครับ" },
    { role: "assistant", content: "พบ XA945 ค่ะ" },
    { role: "user", content: "มีกระดาษทรายหลังกาว 5 นิ้วไหมครับ" },
    { role: "assistant", content: '1. กระดาษทรายกลมหลังกาว MIRKA GOLD 5"\n2. กระดาษทรายกลมหลังกาว PS36 5"' },
  ];

  const route = routeLatestTurn("2", history);
  assert.equal(route.kind, "follow_up");
  assert.match(textOf(route.history), /2\. กระดาษทรายกลมหลังกาว PS36/);
  assert.doesNotMatch(textOf(route.history), /XA945/);
  assert.match(route.topicQuery ?? "", /หลังกาว/);
});

test("quantity reply keeps the latest exact SKU without carrying an old quantity", () => {
  const history = [
    { role: "user", content: 'จานทราย XA945 4" #80 จำนวน 100 ชิ้น' },
    { role: "assistant", content: "พบจานทรายค่ะ" },
    { role: "user", content: 'ม้วนใยสังเคราะห์สีแดง #400 6"x10 M.' },
    { role: "assistant", content: "พบม้วนใยสังเคราะห์สีแดง (SKU 2020002621) ค่ะ ต้องการกี่ม้วนคะ" },
  ];

  const route = routeLatestTurn("2 ม้วน", history);
  assert.equal(route.kind, "follow_up");
  assert.match(textOf(route.history), /SKU 2020002621/);
  assert.doesNotMatch(textOf(route.history), /XA945|100 ชิ้น/);
  assert.match(route.topicQuery ?? "", /ม้วนใยสังเคราะห์/);
});

test("a new product switch starts again from the current product", () => {
  const history = [
    { role: "user", content: 'ม้วนใยสังเคราะห์สีแดง #400 6"x10 M.' },
    { role: "assistant", content: "พบม้วนใยสังเคราะห์สีแดง (SKU 2020002621) ค่ะ" },
  ];

  const route = routeLatestTurn("ขอเปลี่ยนเป็นใบเจียร 4 นิ้ว", history);
  assert.equal(route.kind, "new_product");
  assert.deepEqual(route.history, []);
  assert.match(route.topicQuery ?? "", /ใบเจียร/);
  assert.doesNotMatch(route.topicQuery ?? "", /ม้วนใย|2020002621/);
});

test("a short follow-up after a switch cannot revive an older adhesive-disc topic", () => {
  const history = [
    { role: "user", content: "มีกระดาษทรายหลังกาวไหมครับ" },
    { role: "assistant", content: "มี PS36 และ MIRKA GOLD ค่ะ" },
    { role: "user", content: "ขอเปลี่ยนเป็นใบเจียร 4 นิ้ว" },
    { role: "assistant", content: "มีใบเจียรหลายรุ่นค่ะ" },
  ];

  const route = routeLatestTurn("มีรุ่นไหนบ้าง", history);
  assert.equal(route.kind, "follow_up");
  assert.match(textOf(route.history), /ใบเจียร/);
  assert.doesNotMatch(textOf(route.history), /หลังกาว|PS36|MIRKA/);
  assert.match(route.topicQuery ?? "", /ใบเจียร/);
});

test("an independent delivery question does not inherit product history", () => {
  const history = [
    { role: "user", content: 'จานทราย XA945 4" #80' },
    { role: "assistant", content: "พบจานทรายค่ะ" },
  ];

  const route = routeLatestTurn("จัดส่งสินค้ากี่วันครับ", history);
  assert.equal(route.kind, "independent");
  assert.deepEqual(route.history, []);
  assert.equal(route.topicQuery, null);
});

test("a short quote confirmation still sees the immediately preceding exact offer", () => {
  const offer = { role: "assistant", content: "พบจานทราย (SKU 2020003657) จำนวน 100 ชิ้น ให้เอยทำใบเสนอราคาให้เลยไหมคะ" };
  const route = routeLatestTurn("ทำเลยครับ", [offer]);
  assert.equal(route.kind, "follow_up");
  assert.deepEqual(route.history, [offer]);
});

test("an explicitly different model or product type starts a new topic despite dependent wording", () => {
  const old = [
    { role: "user", content: 'จานทราย XA945 4" #80' },
    { role: "assistant", content: "พบจานทราย XA945 ค่ะ" },
  ];
  for (const query of ["ขอเป็นใบเจียร 4 นิ้ว", "รุ่น SA331 5 นิ้ว มีไหมครับ"]) {
    const route = routeLatestTurn(query, old);
    assert.equal(route.kind, "new_product", query);
    assert.deepEqual(route.history, []);
  }
});

test("changing only size or grit keeps the current product topic", () => {
  const old = [
    { role: "user", content: 'จานทราย XA945 4" #80' },
    { role: "assistant", content: "พบจานทราย XA945 ค่ะ" },
  ];
  for (const query of ["ขอเปลี่ยนเป็นเบอร์ 120", "เปลี่ยนเป็น #120", "เปลี่ยนเบอร์เป็น #120", "ขอเปลี่ยนเป็นขนาด 5 นิ้ว"]) {
    const route = routeLatestTurn(query, old);
    assert.equal(route.kind, "follow_up", query);
    assert.match(textOf(route.history), /XA945/);
  }
});

test("short references to this product keep only the current topic", () => {
  const history = [
    { role: "user", content: 'จานทราย XA945 4" #80' },
    { role: "assistant", content: "พบจานทราย XA945 ค่ะ" },
    { role: "user", content: 'กระดาษทราย SA331 5" #1500' },
    { role: "assistant", content: "พบกระดาษทราย SA331 ค่ะ" },
  ];
  for (const query of ["สินค้านี้ราคาเท่าไหร่", "จานนี้ราคาเท่าไหร่", "เอารุ่นนี้ครับ", "สั่ง 100 ชิ้นครับ", "ใช้เบอร์ 120 ครับ"]) {
    const route = routeLatestTurn(query, history);
    assert.equal(route.kind, "follow_up", query);
    assert.match(textOf(route.history), /SA331/);
    assert.doesNotMatch(textOf(route.history), /XA945/);
  }
});

test("typing a uniquely offered model is a choice, not a new topic", () => {
  const history = [
    { role: "user", content: 'มีกระดาษทรายหลังกาว 5" ไหมครับ' },
    { role: "assistant", content: '1. กระดาษทรายกลมหลังกาว PS36 5"\n2. กระดาษทรายกลมหลังกาว MIRKA GOLD 5"' },
  ];
  for (const query of ["PS36", "MIRKA GOLD"]) {
    const route = routeLatestTurn(query, history);
    assert.equal(route.kind, "follow_up", query);
    assert.match(textOf(route.history), /หลังกาว/);
  }
});
