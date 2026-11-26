'use client';

/* Compact, zero-dependency QR Code generator (Byte mode, ECC Level L, Versions 1..6)
   for rendering instant scannable mobile signing links as crisp SVG. */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  let gen = new Uint8Array([1]);
  for (let i = 0; i < ecLen; i++) {
    const next = new Uint8Array(gen.length + 1);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= EXP[LOG[gen[j]] + i];
    }
    gen = next;
  }
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= EXP[LOG[gen[j + 1]] + LOG[factor]];
      }
    }
  }
  return rem;
}

// Version parameters for Level L (1 block for V1..V5, 2 blocks for V6)
const VERSIONS: { totalData: number; ecPerBlock: number; blocks: number; align: number[] }[] = [
  { totalData: 19, ecPerBlock: 7, blocks: 1, align: [] },
  { totalData: 34, ecPerBlock: 10, blocks: 1, align: [6, 18] },
  { totalData: 55, ecPerBlock: 15, blocks: 1, align: [6, 22] },
  { totalData: 80, ecPerBlock: 20, blocks: 1, align: [6, 26] },
  { totalData: 108, ecPerBlock: 26, blocks: 1, align: [6, 30] },
  { totalData: 136, ecPerBlock: 18, blocks: 2, align: [6, 34] },
];

export function makeQrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  const vIdx = VERSIONS.findIndex((v) => bytes.length + 2 <= v.totalData);
  if (vIdx === -1) return null;
  const ver = vIdx + 1;
  const spec = VERSIONS[vIdx];
  const size = 17 + ver * 4;

  // Build bit stream: Byte mode (0100), 8-bit length, payload, terminator, pad bytes
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);
  const maxBits = spec.totalData * 8;
  pushBits(0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data = new Uint8Array(spec.totalData);
  for (let i = 0; i < bits.length / 8; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
    data[i] = v;
  }
  for (let i = bits.length / 8, p = 0; i < spec.totalData; i++, p ^= 1) {
    data[i] = p === 0 ? 0xec : 0x11;
  }

  // Split into blocks & compute Reed-Solomon EC
  const blockSize = spec.totalData / spec.blocks;
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let b = 0; b < spec.blocks; b++) {
    const slice = data.subarray(b * blockSize, (b + 1) * blockSize);
    dataBlocks.push(slice);
    ecBlocks.push(rsEncode(slice, spec.ecPerBlock));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blockSize; i++) for (let b = 0; b < spec.blocks; b++) codewords.push(dataBlocks[b][i]);
  for (let i = 0; i < spec.ecPerBlock; i++) for (let b = 0; b < spec.blocks; b++) codewords.push(ecBlocks[b][i]);

  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFn = (r: number, c: number, val: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      modules[r][c] = val;
      reserved[r][c] = true;
    }
  };

  // Finder patterns + separators
  const finder = (tr: number, tc: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onRing = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFn(tr + r, tc + c, inOuter && (onRing || inCore));
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const a = spec.align;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === a.length - 1) || (i === a.length - 1 && j === 0)) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          setFn(a[i] + r, a[j] + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  setFn(size - 8, 8, true);

  // Zigzag placement
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const upward = ((size - 1 - right) & 2) === 0;
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          const dark = bitIdx < totalBits && ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) !== 0;
          // Mask 0: (r + c) % 2 === 0
          modules[r][c] = dark !== ((r + c) % 2 === 0);
          bitIdx++;
        }
      }
    }
  }

  // Format bits for Level L (01) + Mask 0 (000) -> 0x77c4
  const fmt = 0x77c4;
  const fBit = (i: number) => ((fmt >> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) modules[8][i] = fBit(14 - i);
  modules[8][7] = fBit(8);
  modules[8][8] = fBit(7);
  modules[7][8] = fBit(6);
  for (let i = 0; i < 6; i++) modules[5 - i][8] = fBit(5 - i);
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = fBit(i);
  for (let i = 0; i < 7; i++) modules[size - 7 + i][8] = fBit(14 - i);

  return modules;
}

export function QrCodeSvg({ value, size = 112 }: { value: string; size?: number }) {
  const m = makeQrMatrix(value);
  if (!m) return null;
  const n = m.length;
  const pad = 2;
  const total = n + pad * 2;
  return (
    <div className="qr-box" title="Scan with your phone camera to open signing page">
      <svg viewBox={`0 0 ${total} ${total}`} width={size} height={size} shapeRendering="crispEdges">
        <rect width={total} height={total} fill="#ffffff" />
        {m.map((row, r) =>
          row.map((cell, c) =>
            cell ? <rect key={`${r}-${c}`} x={c + pad} y={r + pad} width={1} height={1} fill="#0f172a" /> : null,
          ),
        )}
      </svg>
      <span className="small muted">Scan on mobile</span>
    </div>
  );
}
