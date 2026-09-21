/* .xlsx에서 첫 시트를 행 배열로 읽어 온다 — 의존성 없이.
 *
 * 이 앱은 빌드 도구도 node_modules도 없이 굴러가는데, 명단은 늘 엑셀로 온다.
 * 그 한 가지 때문에 패키지를 붙이는 대신, xlsx가 사실 "XML 몇 장을 담은 zip"이라는
 * 점을 그대로 이용한다. zip 중앙 디렉터리를 훑어 필요한 XML 두 장만 꺼내 쓴다.
 * (.csv도 읽을 수 있으니, 이 파일이 버거우면 CSV로 내보내도 된다)
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** zip 중앙 디렉터리를 읽어 { 파일이름: 내용(Buffer) } 로 푼다. */
function unzip(buf) {
  // EOCD(끝 표식)를 뒤에서부터 찾는다. 주석이 붙어 있을 수 있어 앞이 아니라 뒤에서 센다.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip 구조를 찾지 못했습니다 (xlsx 파일이 맞나요?)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // 지역 헤더는 이름·extra 길이가 중앙 디렉터리와 다를 수 있어 거기서 다시 읽는다.
    const lNameLen = buf.readUInt16LE(localAt + 26);
    const lExtraLen = buf.readUInt16LE(localAt + 28);
    const dataAt = localAt + 30 + lNameLen + lExtraLen;
    const compSize = buf.readUInt32LE(p + 20);
    const raw = buf.subarray(dataAt, dataAt + compSize);
    out[name] = method === 0 ? raw : inflateRawSync(raw);

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&');

/** <si>…</si> 안의 <t>들을 이어 붙여 공유 문자열 표를 만든다. */
function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(''));
}

/** 첫 시트를 [{A:'…', B:'…'}, …] 로. 빈 칸은 키 자체가 없다. */
export function readSheet(path) {
  const files = unzip(readFileSync(path));
  const pick = (re) => Object.keys(files).find((k) => re.test(k));
  const sheetName = pick(/^xl\/worksheets\/sheet1\.xml$/) || pick(/^xl\/worksheets\/.*\.xml$/);
  if (!sheetName) throw new Error('시트를 찾지 못했습니다.');
  const ss = sharedStrings(files['xl/sharedStrings.xml']?.toString('utf8'));
  const xml = files[sheetName].toString('utf8');

  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells = {};
    for (const c of row[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>|<c\s([^>]*)\/>/g)) {
      const attrs = c[1] || c[3] || '';
      const inner = c[2] || '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs);
      if (!ref) continue;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let val;
      if (type === 's') {
        const i = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        val = i == null ? '' : (ss[+i] ?? '');
      } else if (type === 'inlineStr') {
        val = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join('');
      } else {
        val = decode(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      }
      val = String(val).trim();
      if (val) cells[ref[1]] = val;
    }
    return cells;
  });
}

/** 아주 단순한 CSV 읽기 — 따옴표로 감싼 칸과 그 안의 쉼표까지만 다룬다. */
export function readCsv(path) {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  return text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    const cells = {};
    out.forEach((v, i) => {
      v = v.trim();
      if (v) cells[String.fromCharCode(65 + i)] = v;
    });
    return cells;
  });
}

export const readTable = (path) => (/\.csv$/i.test(path) ? readCsv(path) : readSheet(path));
