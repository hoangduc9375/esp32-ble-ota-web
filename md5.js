/* Minimal MD5 implementation for ArrayBuffer input. */
(function () {
  "use strict";

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const constants = Array.from({ length: 64 }, (_, index) =>
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) | 0,
  );

  function rotateLeft(value, amount) {
    return (value << amount) | (value >>> (32 - amount));
  }

  function writeWord(output, offset, value) {
    output[offset] = value & 0xff;
    output[offset + 1] = (value >>> 8) & 0xff;
    output[offset + 2] = (value >>> 16) & 0xff;
    output[offset + 3] = (value >>> 24) & 0xff;
  }

  window.md5Bytes = function md5Bytes(buffer) {
    const input = new Uint8Array(buffer);
    const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(input);
    padded[input.length] = 0x80;

    const bitLength = BigInt(input.length) * 8n;
    for (let index = 0; index < 8; index += 1) {
      padded[paddedLength - 8 + index] = Number(
        (bitLength >> BigInt(index * 8)) & 0xffn,
      );
    }

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < padded.length; offset += 64) {
      const words = new Int32Array(16);
      for (let index = 0; index < 16; index += 1) {
        const position = offset + index * 4;
        words[index] =
          padded[position] |
          (padded[position + 1] << 8) |
          (padded[position + 2] << 16) |
          (padded[position + 3] << 24);
      }

      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;

      for (let index = 0; index < 64; index += 1) {
        let mixed;
        let wordIndex;
        if (index < 16) {
          mixed = (b & c) | (~b & d);
          wordIndex = index;
        } else if (index < 32) {
          mixed = (d & b) | (~d & c);
          wordIndex = (5 * index + 1) % 16;
        } else if (index < 48) {
          mixed = b ^ c ^ d;
          wordIndex = (3 * index + 5) % 16;
        } else {
          mixed = c ^ (b | ~d);
          wordIndex = (7 * index) % 16;
        }

        const previousD = d;
        d = c;
        c = b;
        const sum = (a + mixed + constants[index] + words[wordIndex]) | 0;
        b = (b + rotateLeft(sum, shifts[index])) | 0;
        a = previousD;
      }

      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }

    const result = new Uint8Array(16);
    writeWord(result, 0, a0);
    writeWord(result, 4, b0);
    writeWord(result, 8, c0);
    writeWord(result, 12, d0);
    return result;
  };
})();
