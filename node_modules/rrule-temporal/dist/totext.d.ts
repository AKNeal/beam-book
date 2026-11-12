import { RRuleTemporal } from "./index.js";

//#region src/totext.d.ts
interface ToTextOptions {
  includeDtstart?: boolean;
  excludeTzAbbreviation?: boolean;
}
declare function toText(input: RRuleTemporal | string, locale?: string, options?: ToTextOptions): string;
//#endregion
export { ToTextOptions, toText };