// Manually define Vite client types to resolve the error "Cannot find type definition file for 'vite/client'"
interface ImportMetaEnv {
  readonly [key: string]: any;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}