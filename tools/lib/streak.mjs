/* 연속 참여 시즌 수 — 원본은 netlify/functions/_lib/streak.js (서버의 자동 명단 입력과 같은 규칙을 쓰도록 한 곳에 둔다). */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const m = require('../../netlify/functions/_lib/streak.js');
export const { nameKey, emailKey, indexRoster, findInRoster, seasonStreakFor, priorSeasons, loadPriorIndexes } = m;
