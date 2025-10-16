import { useMemo } from 'react';

type Primitive = string | number | boolean;
type QueryValue = Primitive | null | undefined | Primitive[];

type Options = {
  /** Si lo pasas, devuelve URL absoluta. Si no, devuelve relativa. */
  base?: string; // ej: "https://mi.dom"
  /** Parámetros ?clave=valor (se codifican). Valores null/undefined se omiten. */
  query?: Record<string, QueryValue>;
  /** Fragmento #hash (se codifica). */
  hash?: string;
  /** Forzar salida absoluta aunque no haya base explícita (usa window.location.origin). */
  absolute?: boolean;
};

function appendParam(
  sp: URLSearchParams,
  key: string,
  val: QueryValue,
) {
  if (val === null || val === undefined) return;
  if (Array.isArray(val)) {
    for (const v of val) sp.append(key, String(v));
  } else {
    sp.set(key, String(val));
  }
}

export default function useUrl(path: string, opts: Options = {}) {
  return useMemo(() => {
    const origin =
      opts.base ??
      (opts.absolute && typeof window !== 'undefined'
        ? window.location.origin
        : undefined);

    // Construye como absoluta si hay origen; si no, usa base ficticia y luego recorta
    const tmpBase = origin ?? 'http://local';
    const u = new URL(path, tmpBase);

    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query))
        appendParam(u.searchParams, k, v);
    }
    if (opts.hash) u.hash = opts.hash;

    // Si no hay origen real, devuelve relativo: /path?query#hash
    if (!origin) return u.pathname + u.search + u.hash;
    return u.toString();
  }, [path, JSON.stringify(opts)]);
}
