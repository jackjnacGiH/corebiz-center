#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const VERSION = "0.0.31";
const TARBALL_URL =
  `https://registry.npmjs.org/thai-address-database/-/thai-address-database-${VERSION}.tgz`;
const EXPECTED_TARBALL_SHA512 =
  "V605ATRuV/2ic75O21dpV+OpNf02/6lZLrs06/wzXd2emcq36gvdYPNIqK5GMWD/Aja4b5CjNTX3EP3qpfMlxA==";
const EXPECTED_DB_SHA256 =
  "0f21b26fa6715db3420bd54dd6800cb9b9121389759bcee7b2fe9b184ed7cfac";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compactPath = join(root, "frontend", "src", "lib", "thaiAddress.json");
const storefrontPath = join(root, "apps", "storefront", "public", "th-address.json");
const checkOnly = process.argv.includes("--check");

function digest(algorithm, value, encoding = "hex") {
  return createHash(algorithm).update(value).digest(encoding);
}

function extractTarFile(tar, wantedName) {
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString().replace(/\0.*$/, "");
    const sizeText = header.subarray(124, 136).toString().replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const bodyStart = offset + 512;
    if (name === wantedName) return tar.subarray(bodyStart, bodyStart + size);
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Missing ${wantedName} in ${TARBALL_URL}`);
}

function expand(db) {
  const lookup = db.lookup.split("|");
  const words = db.words.split("|");

  function decodeWord(match) {
    const code = match.charCodeAt(0);
    return words[code < 97 ? code - 65 : 26 + code - 97] ?? match;
  }

  function decode(value) {
    const raw = typeof value === "number" ? lookup[value] : value;
    return raw ? raw.replace(/[A-Z]/gi, decodeWord) : "";
  }

  const byPostcode = new Map();
  const seen = new Set();
  for (const [provinceValue, amphoes] of db.data) {
    const province = decode(provinceValue);
    for (const [amphoeValue, tambons] of amphoes) {
      const district = decode(amphoeValue);
      for (const [tambonValue, postcodeValue] of tambons) {
        const subdistrict = decode(tambonValue);
        const postcodes = Array.isArray(postcodeValue) ? postcodeValue : [postcodeValue];
        for (const postcodeValueItem of postcodes) {
          const postcode = String(postcodeValueItem);
          const key = `${postcode}\u0000${subdistrict}\u0000${district}\u0000${province}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const bucket = byPostcode.get(postcode) ?? [];
          bucket.push([subdistrict, district, province]);
          byPostcode.set(postcode, bucket);
        }
      }
    }
  }

  return Object.fromEntries(
    [...byPostcode.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function main() {
  const response = await fetch(TARBALL_URL);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const tarball = Buffer.from(await response.arrayBuffer());
  const tarballDigest = digest("sha512", tarball, "base64");
  if (tarballDigest !== EXPECTED_TARBALL_SHA512) {
    throw new Error("Tarball integrity mismatch");
  }

  const tar = gunzipSync(tarball);
  const packageJson = JSON.parse(
    extractTarFile(tar, "package/package.json").toString("utf8"),
  );
  if (packageJson.version !== VERSION || packageJson.license !== "ISC") {
    throw new Error("Unexpected package metadata");
  }

  const compact = extractTarFile(tar, "package/database/db.json");
  if (digest("sha256", compact) !== EXPECTED_DB_SHA256) {
    throw new Error("Address database checksum mismatch");
  }

  const flat = Buffer.from(JSON.stringify(expand(JSON.parse(compact.toString("utf8")))));
  if (checkOnly) {
    const [currentCompact, currentFlat] = await Promise.all([
      readFile(compactPath),
      readFile(storefrontPath),
    ]);
    if (!currentCompact.equals(compact) || !currentFlat.equals(flat)) {
      throw new Error("Vendored Thai address files are not synchronized");
    }
  } else {
    await Promise.all([
      writeFile(compactPath, compact),
      writeFile(storefrontPath, flat),
    ]);
  }

  const flatData = JSON.parse(flat.toString("utf8"));
  const entryCount = Object.values(flatData).reduce((sum, rows) => sum + rows.length, 0);
  console.log(
    `${checkOnly ? "Verified" : "Updated"} Thai address data ${VERSION}: ` +
      `${Object.keys(flatData).length} postcodes, ${entryCount} address tuples`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
