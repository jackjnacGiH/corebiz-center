import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const alt = "JNAC วัสดุงานขัดและสินค้าอุตสาหกรรม";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const iconData = await readFile(path.join(process.cwd(), "app", "icon.png"));
  const iconSrc = `data:image/png;base64,${iconData.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: "linear-gradient(135deg, #071f35 0%, #0c3c63 62%, #0879bd 100%)",
          color: "white",
          padding: "76px 88px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 52 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={iconSrc}
            alt=""
            width={220}
            height={220}
            style={{ borderRadius: 34, background: "white" }}
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 78, fontWeight: 800, letterSpacing: -2 }}>JNAC</div>
            <div style={{ marginTop: 14, fontSize: 34, fontWeight: 600 }}>
              J NAC (Thailand) Co., Ltd.
            </div>
            <div style={{ marginTop: 24, fontSize: 28, color: "#d9efff" }}>
              Abrasives · Industrial Tools · Engineering Materials · CNC
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
