/** 64-bit "difference hash" of an image, as 16 hex chars, computed in the
 *  browser from a 9x8 grayscale thumbnail. Two copies of the same picture
 *  (re-saved, resized, recompressed) produce hashes that differ by only a
 *  few bits, which the server uses to refuse duplicate uploads. Returns
 *  null on any failure — a missing hash just means only the exact-copy
 *  check applies. */
export async function computePerceptualHash(file: Blob): Promise<string | null> {
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode failed"));
        el.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 9;
      canvas.height = 8;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, 9, 8);
      const { data } = ctx.getImageData(0, 0, 9, 8);
      const gray: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }
      let bits = "";
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          bits += gray[y * 9 + x] > gray[y * 9 + x + 1] ? "1" : "0";
        }
      }
      let hex = "";
      for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
      return hex;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}
