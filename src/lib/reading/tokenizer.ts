// Offline Japanese tokenizer (kuromoji + IPADIC, Apache-2.0). Dictionary files are
// bundled under /kuromoji (copied from node_modules at build time).
import { TokenizerBuilder, type IpadicFeatures } from "@patdx/kuromoji";
import type { Token } from "./coverage";

type Tok = { tokenize(text: string): IpadicFeatures[] };
let loading: Promise<Tok> | null = null;

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const ds = new DecompressionStream("gzip");
  return new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
}

export function getTokenizer(): Promise<Tok> {
  if (!loading) {
    loading = new TokenizerBuilder({
      loader: {
        async loadArrayBuffer(url: string) {
          const name = url.split("/").pop()!;
          const res = await fetch(`/kuromoji/${name}`);
          if (!res.ok) throw new Error(`Dictionary file ${name} missing (${res.status})`);
          const buf = await res.arrayBuffer();
          // Files ship gzipped; some servers already decompress them.
          const bytes = new Uint8Array(buf, 0, 2);
          return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzip(buf) : buf;
        },
      },
    }).build();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export async function tokenize(text: string): Promise<Token[]> {
  const t = await getTokenizer();
  return t.tokenize(text.normalize("NFKC")).map((x) => ({
    surface: x.surface_form,
    basic: x.basic_form,
    reading: x.reading,
    pos: x.pos,
    pos1: x.pos_detail_1,
  }));
}
