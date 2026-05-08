from __future__ import annotations

import json
import re
import time
from collections import deque
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import quote, urldefrag, urljoin, urlparse
from urllib.request import Request, urlopen


BASE = "https://www.jnac.co.th/"
OUT = Path("jnac_site_data.json")


SKIP_EXTENSIONS = (
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".pdf",
    ".zip",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
)


@dataclass
class PageData:
    url: str
    title: str
    headings: list[str]
    text: str
    links: list[dict[str, str]]


class TextAndLinksParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.current_tag: str | None = None
        self.skip_depth = 0
        self.text_parts: list[str] = []
        self.headings: list[str] = []
        self._heading_tag: str | None = None
        self._heading_parts: list[str] = []
        self.links: list[dict[str, str]] = []
        self._href: str | None = None
        self._link_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.current_tag = tag.lower()
        if self.current_tag in {"script", "style", "noscript", "svg"}:
            self.skip_depth += 1
            return
        if self.current_tag in {"h1", "h2", "h3"}:
            self._heading_tag = self.current_tag
            self._heading_parts = []
        if self.current_tag == "a":
            attrs_dict = dict(attrs)
            self._href = attrs_dict.get("href")
            self._link_parts = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg"} and self.skip_depth:
            self.skip_depth -= 1
            return
        if tag == "title":
            self.current_tag = None
        if tag == self._heading_tag:
            heading = clean_text(" ".join(self._heading_parts))
            if heading and heading not in self.headings:
                self.headings.append(heading)
            self._heading_tag = None
            self._heading_parts = []
        if tag == "a" and self._href:
            label = clean_text(" ".join(self._link_parts))
            if label or self._href:
                self.links.append({"href": self._href, "text": label})
            self._href = None
            self._link_parts = []
        if tag in {"p", "div", "li", "br", "tr", "h1", "h2", "h3", "h4"}:
            self.text_parts.append("\n")
        self.current_tag = None

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        text = data.strip()
        if not text:
            return
        if self.current_tag == "title":
            self.title_parts.append(text)
        if self._heading_tag:
            self._heading_parts.append(text)
        if self._href is not None:
            self._link_parts.append(text)
        self.text_parts.append(text)


def clean_text(value: str) -> str:
    value = re.sub(r"[\t\r\f\v]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    value = re.sub(r"[ \u00a0]{2,}", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def normalize_url(url: str, base: str = BASE) -> str | None:
    url = urljoin(base, url)
    url, _ = urldefrag(url)
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return None
    if parsed.netloc.lower().replace("www.", "") != "jnac.co.th":
        return None
    path = parsed.path or "/"
    lower_path = path.lower()
    if any(lower_path.endswith(ext) for ext in SKIP_EXTENSIONS):
        return None
    if any(part in lower_path for part in ["/member", "/cart", "/login", "/register"]):
        return None
    path = quote(path, safe="/%")
    return parsed._replace(scheme="https", netloc="www.jnac.co.th", path=path).geturl()


def fetch(url: str) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 Codex research bot"})
    with urlopen(req, timeout=30) as response:
        raw = response.read()
        content_type = response.headers.get("content-type", "")
    if "text/html" not in content_type and b"<html" not in raw[:500].lower():
        return ""
    for enc in ("utf-8", "tis-620", "windows-874"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_page(url: str, html: str) -> PageData:
    parser = TextAndLinksParser()
    parser.feed(html)
    title = clean_text(" ".join(parser.title_parts))
    text = clean_text("\n".join(parser.text_parts))
    return PageData(
        url=url,
        title=title,
        headings=parser.headings,
        text=text,
        links=parser.links,
    )


def unique_urls(links: Iterable[dict[str, str]], base: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for link in links:
        norm = normalize_url(link.get("href", ""), base)
        if norm and norm not in seen:
            seen.add(norm)
            urls.append(norm)
    return urls


def main() -> None:
    queue: deque[str] = deque([BASE])
    seen: set[str] = set()
    pages: list[PageData] = []
    errors: dict[str, str] = {}

    while queue and len(seen) < 220:
        url = queue.popleft()
        if url in seen:
            continue
        seen.add(url)
        try:
            html = fetch(url)
            if not html:
                continue
            page = parse_page(url, html)
            pages.append(page)
            for nxt in unique_urls(page.links, url):
                if nxt not in seen and nxt not in queue:
                    queue.append(nxt)
            print(f"{len(pages):03d} {url}", flush=True)
            time.sleep(0.08)
        except Exception as exc:  # noqa: BLE001
            errors[url] = str(exc)
            print(f"ERR {url} {exc}", flush=True)

    payload = {
        "source": BASE,
        "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S %z"),
        "page_count": len(pages),
        "errors": errors,
        "pages": [asdict(page) for page in pages],
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT} with {len(pages)} pages")


if __name__ == "__main__":
    main()
