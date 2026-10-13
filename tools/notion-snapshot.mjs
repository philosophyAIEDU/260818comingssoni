#!/usr/bin/env node
/**
 * 노션 공개 페이지를 마크다운 사본으로 저장한다 — 시즌이 바뀌어도 이전 버전 문구를 지우지 않고 보관하기 위해.
 *
 *   node tools/notion-snapshot.mjs <페이지ID> <저장할 파일>
 *   node tools/notion-snapshot.mjs 3f7f15a6c51c81be9d17e6fc046910d4 archive/s3-혁명의팡파르/상세페이지.md
 *
 * - 공개(웹에 게시)된 페이지만 읽는다(로그인 없이 capable-hook-3dd.notion.site 공개 API).
 * - 토글·콜아웃·열(column) 안쪽까지 모두 따라가서 적는다.
 * - 이미 같은 파일이 있으면 덮어쓰지 않고 "파일명.YYYY-MM-DD_HHmm.md"로 따로 남긴다(보관이 목적이라 지우지 않는다).
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const SITE = 'https://capable-hook-3dd.notion.site/api/v3/';

async function post(path, body) {
  try {
    const res = await fetch(SITE + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) return await res.json();
  } catch (e) { /* 프록시 환경 등 — 아래 curl로 */ }
  const out = execFileSync('curl', ['-sS', '-X', 'POST', SITE + path, '-H', 'content-type: application/json',
    '-d', JSON.stringify(body)], { maxBuffer: 50e6 }).toString();
  return JSON.parse(out);
}

const toUuid = (id) => {
  const h = id.replace(/[^0-9a-f]/gi, '').slice(-32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

async function loadAll(pageId) {
  const blocks = {};
  const take = (rm) => Object.entries((rm && rm.block) || {}).forEach(([k, v]) => {
    const val = v.value && v.value.value ? v.value.value : v.value;
    if (val) blocks[k] = { val, space: v.spaceId || val.space_id };
  });
  let cursor = { stack: [] };
  for (let n = 0; n < 50; n++) {
    const r = await post('loadPageChunk', { pageId, limit: 500, cursor, chunkNumber: n, verticalColumns: false });
    take(r.recordMap);
    if (!r.cursor || !r.cursor.stack || !r.cursor.stack.length) break;
    cursor = r.cursor;
  }
  if (!blocks[pageId]) throw new Error('공개 페이지를 읽지 못했습니다(웹에 게시되어 있는지 확인): ' + pageId);
  const space = blocks[pageId].space;
  // 토글 안쪽처럼 처음 묶음에 안 오는 블록을 끝까지 채운다
  for (let round = 0; round < 20; round++) {
    const missing = [];
    for (const { val } of Object.values(blocks)) {
      for (const c of val.content || []) if (!blocks[c] && !missing.includes(c)) missing.push(c);
    }
    if (!missing.length) break;
    for (let i = 0; i < missing.length; i += 50) {
      const r = await post('syncRecordValuesMain', {
        requests: missing.slice(i, i + 50).map((id) => ({ pointer: { table: 'block', id, spaceId: space }, version: -1 })),
      });
      take(r.recordMap);
    }
  }
  return blocks;
}

function rich(arr) {
  if (!arr) return '';
  return arr.map(([text, ann]) => {
    let t = text;
    if (t === '‣') return '';
    // 굵게·기울임은 줄마다 따로 감싼다(줄바꿈을 끼고 감싸면 ** 가 줄 끝에 홀로 남는다)
    const wrap = (s, m) => s.split('\n').map((x) => (x.trim() ? `${m}${x.trim()}${m}${x.endsWith(' ') ? ' ' : ''}` : x)).join('\n');
    for (const a of ann || []) {
      if (a[0] === 'b') t = wrap(t, '**');
      else if (a[0] === 'i') t = wrap(t, '*');
      else if (a[0] === 's') t = wrap(t, '~~');
      else if (a[0] === 'c') t = '`' + t + '`';
      else if (a[0] === 'a') t = `[${t}](${a[1]})`;
    }
    return t;
  }).join('');
}

function render(blocks, rootId) {
  const lines = [];
  const val = (id) => (blocks[id] ? blocks[id].val : null);
  function walk(id, depth, numberRef) {
    const b = val(id);
    if (!b || b.alive === false) return;
    const pad = '  '.repeat(depth);
    const p = b.properties || {};
    const title = rich(p.title);
    const kids = b.content || [];
    let childDepth = depth;
    switch (b.type) {
      case 'header': lines.push('', `${pad}# ${title}`); break;
      case 'sub_header': lines.push('', `${pad}## ${title}`); break;
      case 'sub_sub_header': lines.push('', `${pad}### ${title}`); break;
      case 'text': lines.push(title ? `${pad}${title}` : ''); break;
      case 'bulleted_list': lines.push(`${pad}- ${title}`); childDepth = depth + 1; break;
      case 'numbered_list': lines.push(`${pad}${++numberRef.n}. ${title}`); childDepth = depth + 1; break;
      case 'to_do': lines.push(`${pad}- [${p.checked && p.checked[0] && p.checked[0][0] === 'Yes' ? 'x' : ' '}] ${title}`); childDepth = depth + 1; break;
      case 'toggle': lines.push(`${pad}▸ ${title}`); childDepth = depth + 1; break;
      case 'quote': lines.push(`${pad}> ${title}`); break;
      case 'callout': lines.push(`${pad}> ${(b.format && b.format.page_icon) || '💡'} ${title}`); childDepth = depth + 1; break;
      case 'divider': lines.push(`${pad}---`); break;
      case 'code': lines.push('```', rich(p.title), '```'); break;
      case 'image': {
        const src = (b.format && b.format.display_source) || (p.source && p.source[0] && p.source[0][0]) || '';
        lines.push(`${pad}![이미지](${src.startsWith('attachment:') ? '(노션 첨부 이미지)' : src})`);
        break;
      }
      case 'bookmark': case 'embed': case 'video': {
        const link = (p.link && p.link[0] && p.link[0][0]) || (p.source && p.source[0] && p.source[0][0]) || '';
        lines.push(`${pad}[${rich(p.title) || b.type}](${link})`);
        break;
      }
      case 'page':
        if (id === rootId) lines.push(`# ${title}`);
        else { lines.push(`${pad}📄 하위 페이지: ${title}`); return; }
        break;
      case 'table': {
        const order = (b.format && b.format.table_block_column_order) || [];
        kids.forEach((rid, i) => {
          const row = val(rid);
          const cells = order.map((c) => rich(row && row.properties && row.properties[c]).replace(/\|/g, '\\|'));
          lines.push(`${pad}| ${cells.join(' | ')} |`);
          if (i === 0) lines.push(`${pad}|${order.map(() => ' --- ').join('|')}|`);
        });
        return;
      }
      case 'column_list': case 'column': break;
      default: if (title) lines.push(`${pad}${title}`);
    }
    const ref = { n: 0 };
    for (const k of kids) {
      const kt = val(k) && val(k).type;
      if (kt !== 'numbered_list') ref.n = 0;
      walk(k, childDepth, ref);
    }
  }
  walk(rootId, 0, { n: 0 });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const [, , rawId, outPath] = process.argv;
if (!rawId || !outPath) {
  console.error('사용법: node tools/notion-snapshot.mjs <노션 페이지 ID> <저장할 파일>');
  process.exit(1);
}
const pageId = toUuid(rawId);
const blocks = await loadAll(pageId);
const md = `<!-- 노션 공개 페이지 사본 · https://capable-hook-3dd.notion.site/${pageId.replace(/-/g, '')} · ${new Date().toISOString()} 기준 -->\n\n`
  + render(blocks, pageId);
mkdirSync(dirname(outPath), { recursive: true });
let dest = outPath;
if (existsSync(dest)) {
  const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const ext = extname(dest);
  dest = dest.slice(0, dest.length - ext.length) + `.${stamp}${ext}`;
}
writeFileSync(dest, md);
console.log(`✓ ${dest} (${md.split('\n').length}줄)`);
