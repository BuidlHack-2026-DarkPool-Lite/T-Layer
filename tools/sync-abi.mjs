#!/usr/bin/env node
/**
 * sync-abi.mjs — Hardhat 컴파일 산출물에서 DarkPoolEscrow ABI를 추출해
 * packages/contracts-abi/DarkPoolEscrow.json 으로 동기화.
 *
 * 호출 위치 무관 (apps/contracts의 postcompile 훅 또는 root에서 직접).
 * 출력 JSON은 { contractName, sourceName, abi } 만 포함 (bytecode 제외).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const SOURCES = [
  {
    name: 'DarkPoolEscrow',
    artifact: 'apps/contracts/artifacts/contracts/DarkPoolEscrow.sol/DarkPoolEscrow.json',
    out: 'packages/contracts-abi/DarkPoolEscrow.json',
  },
];

async function syncOne({ name, artifact, out }) {
  const artifactPath = resolve(REPO_ROOT, artifact);
  const outPath = resolve(REPO_ROOT, out);

  if (!existsSync(artifactPath)) {
    throw new Error(
      `[sync-abi] artifact not found: ${artifactPath}\n` +
        `먼저 'npm run compile'을 apps/contracts에서 실행하세요.`,
    );
  }

  const raw = JSON.parse(await readFile(artifactPath, 'utf8'));

  // 기대 필드 검증 — Hardhat artifacts 스키마가 깨지면 undefined 필드를
  // 그대로 직렬화해서 잘못된 산출물이 디스크에 써지는 사고 방지.
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof raw.contractName !== 'string' ||
    typeof raw.sourceName !== 'string' ||
    !Array.isArray(raw.abi)
  ) {
    throw new Error(
      `[sync-abi] invalid artifact structure for ${name}: ` +
        `expected {contractName: string, sourceName: string, abi: array}, ` +
        `got keys=${Object.keys(raw || {}).join(',')} (${artifactPath})`,
    );
  }

  const minimal = {
    contractName: raw.contractName,
    sourceName: raw.sourceName,
    abi: raw.abi,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(minimal, null, 2) + '\n', 'utf8');

  const fnCount = raw.abi.filter((e) => e.type === 'function').length;
  const evCount = raw.abi.filter((e) => e.type === 'event').length;
  console.log(
    `[sync-abi] ${name}: ${fnCount} functions, ${evCount} events → ${out}`,
  );
}

async function main() {
  for (const src of SOURCES) {
    await syncOne(src);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
