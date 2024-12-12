import { Rule } from 'postcss'

export interface PostcssPxToViewportOptions {
    unitToConvert: string,
    viewportWidth: number,
    viewportHeight: number, // not now used; TODO: need for different units and math for different properties
    unitPrecision: number,
    viewportUnit: string,
    fontViewportUnit: string,  // vmin is more suitable.
    selectorBlackList: string[],
    propList: string[],
    minPixelValue: number,
    mediaQuery: boolean,
    replace: boolean,
    landscape: boolean,
    landscapeUnit: string,
    landscapeWidth: number,
    exclude?: RegExp | RegExp[],
    include?: RegExp | RegExp[],
  }

export type ParentExtendType = { prop: string; value: string; params: string };

export type ParentType = {
  parent: Rule['parent'] & ParentExtendType | undefined;
};

export type RuleType = Omit<Rule, 'parent'> & ParentType;