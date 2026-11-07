// The one Node built-in the tests use (the project carries no @types/node): noLicensedAudio.test.ts asks git.
declare module 'node:child_process' {
  export function execFileSync(file: string, args: readonly string[], options: { encoding: 'utf8' }): string;
}
