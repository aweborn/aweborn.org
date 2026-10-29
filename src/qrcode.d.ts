// Minimal types for the `qrcode` package (no @types in the repo): only what MeshPanel uses.
declare module 'qrcode' {
  interface QRCodeToStringOptions {
    type?: 'svg' | 'utf8' | 'terminal'
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
    margin?: number
    color?: { dark?: string; light?: string }
  }
  export function toString(text: string, options?: QRCodeToStringOptions): Promise<string>
  const QRCode: { toString: typeof toString }
  export default QRCode
}
