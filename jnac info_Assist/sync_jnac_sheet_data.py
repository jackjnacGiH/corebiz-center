from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen


SPREADSHEET_ID = "1c3U81eazLDTMQTdDScObASikKgYJf_qmKabn4Lyf1Og"
INVENTORY_SHEET = "Inventory"
FLOWACCOUNT_SHEET = "รหัส FlowAccount"
PRODUCT_PRICE_GID = "0"

OUT_JSONL = Path("jnac_admin_products.jsonl")
OUT_CSV = Path("jnac_admin_products.csv")
OUT_PRICE_RULES_JSONL = Path("jnac_product_price_rules.jsonl")
OUT_PRICE_RULES_CSV = Path("jnac_product_price_rules.csv")
STATE_FILE = Path("jnac_sheet_sync_state.json")


def clean(value: object) -> str:
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ")
    return " ".join(text.replace("\r", "\n").split())


def parse_number(value: object) -> float | None:
    text = clean(value).replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def extract_grits(value: str) -> tuple[str, ...]:
    grits = re.findall(r"#\s*(\d+)", value or "")
    return tuple(dict.fromkeys(str(int(grit)) for grit in grits))


def normalize_product_base(value: str) -> str:
    text = clean(value).lower()
    text = re.sub(r"(\d)\s*\"", r"\1นิ้ว", text)
    text = text.replace('"', "นิ้ว")
    text = re.sub(r"(\d)\s*นิ้ว", r"\1นิ้ว", text)
    text = re.sub(r"#\s*\d+", " ", text)
    text = re.sub(r"\b\d{8,}\b", " ", text)
    return re.sub(r"[^0-9a-z\u0e00-\u0e7f]+", "", text)


def product_base_display(value: str) -> str:
    text = clean(value)
    text = re.sub(r"#\s*\d+", " ", text)
    return clean(text)


def fetch_sheet_csv(sheet_name: str) -> list[dict[str, str]]:
    url = (
        f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/gviz/tq"
        f"?tqx=out:csv&sheet={quote(sheet_name)}"
    )
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 Codex sheet sync"})
    with urlopen(req, timeout=45) as response:
        raw = response.read()
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict[str, str]] = []
    for row in reader:
        normalized: dict[str, str] = {}
        for key, value in row.items():
            key = clean(key)
            if not key:
                continue
            if "รูปภาพ" in key or "image" in key.lower():
                continue
            normalized[key] = clean(value)
        if any(normalized.values()):
            rows.append(normalized)
    return rows


def fetch_product_price_rows() -> list[dict[str, str]]:
    url = (
        f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/export"
        f"?format=csv&gid={PRODUCT_PRICE_GID}"
    )
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 Codex sheet sync"})
    with urlopen(req, timeout=45) as response:
        raw = response.read()
    text = raw.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text))
    rows: list[dict[str, str]] = []
    try:
        next(reader)
    except StopIteration:
        return rows
    for row_number, row in enumerate(reader, start=2):
        padded = row + [""] * 7
        product_code, name, unit, detail, price, stock, note = padded[:7]
        product_code = clean(product_code)
        if product_code in {"Payment", "Maps"}:
            continue
        record = {
            "source_row": str(row_number),
            "ProductCode": product_code,
            "Name": clean(name),
            "Unit": clean(unit),
            "Detail": clean(detail),
            "ราคา": clean(price),
            "คงเหลือ": clean(stock),
            "Note.": clean(note),
        }
        if record["Name"] or record["ราคา"]:
            rows.append(record)
    return rows


def sha256_json(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_price_rules(product_rows: list[dict[str, str]]) -> tuple[list[dict], dict[str, list[dict]]]:
    rules: list[dict] = []
    rules_by_base: dict[str, list[dict]] = {}
    for idx, row in enumerate(product_rows, start=1):
        name = clean(row.get("Name"))
        price = parse_number(row.get("ราคา"))
        if not name or price is None:
            continue
        grits = extract_grits(name)
        base_key = normalize_product_base(name)
        if not base_key:
            continue
        unit = clean(row.get("Unit"))
        base_name = product_base_display(name)
        rule = {
            "id": f"jnac_price_rule_{idx:04d}",
            "type": "price_rule",
            "source_row": row.get("source_row"),
            "source_product_code": clean(row.get("ProductCode")),
            "name": name,
            "base_name": base_name,
            "base_key": base_key,
            "grits": list(grits),
            "unit": unit,
            "price": price,
            "stock_from_product_sheet": parse_number(row.get("คงเหลือ")),
            "detail": clean(row.get("Detail")),
            "note": clean(row.get("Note.")),
        }
        rule["embedding_text"] = "\n".join(
            part
            for part in [
                f"รายการราคา: {base_name}",
                f"เบอร์: {' '.join('#' + grit for grit in grits)}" if grits else "",
                f"รายละเอียด: {rule['detail']}" if rule["detail"] else "",
                f"ราคา: {money(price)} ต่อ{unit}" if unit else f"ราคา: {money(price)}",
            ]
            if part
        )
        rule["answer_text"] = (
            f"{base_name} "
            f"{' '.join('#' + grit for grit in grits)} "
            f"ราคา{unit}ละ {money(price)}"
        ).strip()
        rule["hash"] = sha256_json(
            {
                "name": rule["name"],
                "grits": rule["grits"],
                "unit": rule["unit"],
                "price": rule["price"],
                "detail": rule["detail"],
                "note": rule["note"],
            }
        )
        rules.append(rule)
        rules_by_base.setdefault(base_key, []).append(rule)
    return rules, rules_by_base


def resolve_product_price(name: str, rules_by_base: dict[str, list[dict]]) -> dict:
    base_key = normalize_product_base(name)
    item_grits = set(extract_grits(name))
    candidates = rules_by_base.get(base_key, [])
    if not candidates:
        return {
            "price": None,
            "unit": "",
            "source": "Product:no_match",
            "matched_rule_id": "",
            "matched_rule_name": "",
            "matched_grits": [],
        }

    scored: list[tuple[int, dict]] = []
    for rule in candidates:
        rule_grits = set(rule["grits"])
        if item_grits and rule_grits and not (item_grits & rule_grits):
            continue
        score = 100
        if item_grits and rule_grits:
            score += 20 + len(item_grits & rule_grits)
            if item_grits <= rule_grits:
                score += 5
        if not item_grits and not rule_grits:
            score += 5
        scored.append((score, rule))

    if not scored:
        return {
            "price": None,
            "unit": "",
            "source": "Product:base_match_grit_not_found",
            "matched_rule_id": "",
            "matched_rule_name": "",
            "matched_grits": [],
        }

    scored.sort(key=lambda item: item[0], reverse=True)
    rule = scored[0][1]
    return {
        "price": rule["price"],
        "unit": rule["unit"],
        "source": "Product",
        "matched_rule_id": rule["id"],
        "matched_rule_name": rule["name"],
        "matched_grits": rule["grits"],
    }


def availability(stock: float | None) -> str:
    if stock is None:
        return "ไม่ระบุคงเหลือ"
    if stock > 0:
        return "มีสินค้า"
    return "ไม่มีสินค้า/คงเหลือเป็น 0"


def money(value: float | None) -> str:
    if value is None:
        return "ไม่ระบุราคา"
    return f"{value:,.2f} บาท"


def stock_text(value: float | None, unit: str) -> str:
    if value is None:
        return "ไม่ระบุคงเหลือ"
    if value.is_integer():
        amount = str(int(value))
    else:
        amount = f"{value:g}"
    return f"{amount} {unit}".strip()


def build_records() -> tuple[list[dict], dict]:
    fetched_at = datetime.now(timezone.utc).isoformat()
    inventory_rows = fetch_sheet_csv(INVENTORY_SHEET)
    flow_rows = fetch_sheet_csv(FLOWACCOUNT_SHEET)
    product_price_rows = fetch_product_price_rows()
    price_rules, rules_by_base = build_price_rules(product_price_rows)

    inventory_by_code: dict[str, dict[str, str]] = {}
    for row in inventory_rows:
        code = clean(row.get("Barcode"))
        if code:
            inventory_by_code[code] = row

    flow_by_code: dict[str, dict[str, str]] = {}
    for row in flow_rows:
        code = clean(row.get("ProductCode"))
        if code:
            flow_by_code[code] = row

    all_codes = sorted(set(flow_by_code) | set(inventory_by_code))
    records: list[dict] = []

    for code in all_codes:
        flow = flow_by_code.get(code, {})
        inv = inventory_by_code.get(code, {})
        name = clean(flow.get("Name")) or clean(inv.get("Name"))
        description = clean(flow.get("Description")) or clean(inv.get("Detail"))
        category = clean(inv.get("Category"))
        price_match = resolve_product_price(name, rules_by_base)
        unit = clean(inv.get("Unit")) or clean(price_match.get("unit"))
        inventory_price = parse_number(inv.get("Price"))
        price = price_match["price"]
        stock = parse_number(inv.get("Stock"))
        min_stock = parse_number(inv.get("Min_Stock"))
        shelf = clean(inv.get("Shelf"))
        row = clean(inv.get("Row"))
        flow_qty = parse_number(flow.get("Qty"))

        stable_payload = {
            "product_code": code,
            "name": name,
            "category": category,
            "description": description,
            "unit": unit,
        }
        live_payload = {
            "price": price,
            "price_source": price_match["source"],
            "price_rule_id": price_match["matched_rule_id"],
            "inventory_price": inventory_price,
            "stock": stock,
            "min_stock": min_stock,
            "shelf": shelf,
            "row": row,
            "flowaccount_qty": flow_qty,
        }

        embedding_text = "\n".join(
            part
            for part in [
                f"รหัสสินค้า: {code}",
                f"ชื่อสินค้า: {name}",
                f"หมวดหมู่: {category}" if category else "",
                f"รายละเอียด: {description}" if description else "",
                f"หน่วย: {unit}" if unit else "",
            ]
            if part
        )
        answer_text = "\n".join(
            part
            for part in [
                f"รหัสสินค้า: {code}",
                f"ชื่อสินค้า: {name}",
                f"รายละเอียด: {description}" if description else "",
                f"ราคา: {money(price)}",
                f"คงเหลือ: {stock_text(stock, unit)}",
                f"หน่วย: {unit}" if unit else "",
                f"ตำแหน่งจัดเก็บ: Shelf {shelf}, Row {row}" if shelf or row else "",
            ]
            if part
        )

        record = {
            "id": f"jnac_product_{code}",
            "type": "product",
            "product_code": code,
            "name": name,
            "category": category,
            "description": description,
            "unit": unit,
            "price": price,
            "inventory_price": inventory_price,
            "price_source": price_match["source"],
            "price_rule_id": price_match["matched_rule_id"],
            "price_rule_name": price_match["matched_rule_name"],
            "price_rule_grits": price_match["matched_grits"],
            "stock": stock,
            "min_stock": min_stock,
            "availability": availability(stock),
            "shelf": shelf,
            "row": row,
            "flowaccount_qty": flow_qty,
            "embedding_text": embedding_text,
            "answer_text": answer_text,
            "source": {
                "spreadsheet_id": SPREADSHEET_ID,
                "inventory_sheet": INVENTORY_SHEET if code in inventory_by_code else None,
                "flowaccount_sheet": FLOWACCOUNT_SHEET if code in flow_by_code else None,
                "product_price_gid": PRODUCT_PRICE_GID if price_match["source"] == "Product" else None,
                "fetched_at": fetched_at,
            },
            "hashes": {
                "embedding_hash": sha256_json(stable_payload),
                "live_hash": sha256_json(live_payload),
                "row_hash": sha256_json({"stable": stable_payload, "live": live_payload}),
            },
        }
        records.append(record)

    price_matched = sum(1 for record in records if record["price_source"] == "Product")
    summary = {
        "fetched_at": fetched_at,
        "spreadsheet_id": SPREADSHEET_ID,
        "inventory_rows": len(inventory_rows),
        "flowaccount_rows": len(flow_rows),
        "product_price_rows": len(product_price_rows),
        "product_price_rules": len(price_rules),
        "output_records": len(records),
        "price_matched_records": price_matched,
        "price_unmatched_records": len(records) - price_matched,
        "inventory_only_codes": len(set(inventory_by_code) - set(flow_by_code)),
        "flowaccount_only_codes": len(set(flow_by_code) - set(inventory_by_code)),
        "price_rules": price_rules,
    }
    return records, summary


def write_outputs(records: list[dict], summary: dict) -> dict:
    price_rules = summary.get("price_rules", [])
    old_state = {}
    if STATE_FILE.exists():
        try:
            old_state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            old_state = {}
    old_hashes = old_state.get("row_hashes", {})

    row_hashes = {record["product_code"]: record["hashes"]["row_hash"] for record in records}
    embedding_hashes = {
        record["product_code"]: record["hashes"]["embedding_hash"] for record in records
    }
    live_hashes = {record["product_code"]: record["hashes"]["live_hash"] for record in records}

    old_embedding = old_state.get("embedding_hashes", {})
    old_live = old_state.get("live_hashes", {})

    changed_rows = [code for code, value in row_hashes.items() if old_hashes.get(code) != value]
    changed_embedding = [
        code for code, value in embedding_hashes.items() if old_embedding.get(code) != value
    ]
    changed_live = [code for code, value in live_hashes.items() if old_live.get(code) != value]

    with OUT_JSONL.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")

    with OUT_PRICE_RULES_JSONL.open("w", encoding="utf-8", newline="\n") as handle:
        for rule in price_rules:
            handle.write(json.dumps(rule, ensure_ascii=False, separators=(",", ":")) + "\n")

    csv_fields = [
        "product_code",
        "name",
        "category",
        "description",
        "unit",
        "price",
        "inventory_price",
        "price_source",
        "price_rule_id",
        "price_rule_name",
        "price_rule_grits",
        "stock",
        "min_stock",
        "availability",
        "shelf",
        "row",
        "flowaccount_qty",
        "embedding_text",
        "answer_text",
        "embedding_hash",
        "live_hash",
        "row_hash",
    ]
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=csv_fields)
        writer.writeheader()
        for record in records:
            writer.writerow(
                {
                    "product_code": record["product_code"],
                    "name": record["name"],
                    "category": record["category"],
                    "description": record["description"],
                    "unit": record["unit"],
                    "price": "" if record["price"] is None else record["price"],
                    "inventory_price": ""
                    if record["inventory_price"] is None
                    else record["inventory_price"],
                    "price_source": record["price_source"],
                    "price_rule_id": record["price_rule_id"],
                    "price_rule_name": record["price_rule_name"],
                    "price_rule_grits": " ".join(
                        "#" + grit for grit in record["price_rule_grits"]
                    ),
                    "stock": "" if record["stock"] is None else record["stock"],
                    "min_stock": "" if record["min_stock"] is None else record["min_stock"],
                    "availability": record["availability"],
                    "shelf": record["shelf"],
                    "row": record["row"],
                    "flowaccount_qty": ""
                    if record["flowaccount_qty"] is None
                    else record["flowaccount_qty"],
                    "embedding_text": record["embedding_text"],
                    "answer_text": record["answer_text"],
                    "embedding_hash": record["hashes"]["embedding_hash"],
                    "live_hash": record["hashes"]["live_hash"],
                    "row_hash": record["hashes"]["row_hash"],
                }
            )

    price_rule_fields = [
        "id",
        "source_row",
        "source_product_code",
        "base_name",
        "name",
        "grits",
        "unit",
        "price",
        "detail",
        "note",
        "embedding_text",
        "answer_text",
        "hash",
    ]
    with OUT_PRICE_RULES_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=price_rule_fields)
        writer.writeheader()
        for rule in price_rules:
            writer.writerow(
                {
                    "id": rule["id"],
                    "source_row": rule["source_row"],
                    "source_product_code": rule["source_product_code"],
                    "base_name": rule["base_name"],
                    "name": rule["name"],
                    "grits": " ".join("#" + grit for grit in rule["grits"]),
                    "unit": rule["unit"],
                    "price": rule["price"],
                    "detail": rule["detail"],
                    "note": rule["note"],
                    "embedding_text": rule["embedding_text"],
                    "answer_text": rule["answer_text"],
                    "hash": rule["hash"],
                }
            )

    state_summary = {key: value for key, value in summary.items() if key != "price_rules"}
    state = {
        **state_summary,
        "output_jsonl": str(OUT_JSONL.resolve()),
        "output_csv": str(OUT_CSV.resolve()),
        "output_price_rules_jsonl": str(OUT_PRICE_RULES_JSONL.resolve()),
        "output_price_rules_csv": str(OUT_PRICE_RULES_CSV.resolve()),
        "price_rule_hashes": {rule["id"]: rule["hash"] for rule in price_rules},
        "changed_rows": len(changed_rows),
        "changed_embedding_rows": len(changed_embedding),
        "changed_live_rows": len(changed_live),
        "changed_row_codes": changed_rows[:500],
        "changed_embedding_codes": changed_embedding[:500],
        "changed_live_codes": changed_live[:500],
        "row_hashes": row_hashes,
        "embedding_hashes": embedding_hashes,
        "live_hashes": live_hashes,
    }
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    return state


def main() -> None:
    records, summary = build_records()
    state = write_outputs(records, summary)
    print(json.dumps({k: state[k] for k in [
        "fetched_at",
        "inventory_rows",
        "flowaccount_rows",
        "product_price_rows",
        "product_price_rules",
        "output_records",
        "price_matched_records",
        "price_unmatched_records",
        "inventory_only_codes",
        "flowaccount_only_codes",
        "changed_rows",
        "changed_embedding_rows",
        "changed_live_rows",
        "output_jsonl",
        "output_csv",
        "output_price_rules_jsonl",
        "output_price_rules_csv",
    ]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
