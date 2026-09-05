export type PlistJsObj = any[] | Record<any, any>;

/** Wraps a number so it is always encoded as a binary plist `real`. */
export declare class Real {
  constructor(value: number);
  value: number;
}

declare function bplistCreator(object: PlistJsObj): Buffer;

declare namespace bplistCreator {
  export { Real };
}

export default bplistCreator;
