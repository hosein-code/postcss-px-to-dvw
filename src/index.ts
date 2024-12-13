import { atRule, ChildNode, Comment, Declaration, Root, Rule } from "postcss";
import { getUnitRegexp } from "./pixel-unit-regexp.js";
import { createPropListMatcher } from "./prop-list-matcher.js";
import { isRegExp, isArray, isString } from "./is.js";
import {
  RuleType,
  PostcssPxToViewportOptions,
  ParentExtendType,
} from "./types.js";
import { ContainerWithChildren } from "postcss/lib/container";

const defaults: PostcssPxToViewportOptions = {
  unitToConvert: "px",
  viewportWidth: 320,
  viewportHeight: 568, // not now used; TODO: need for different units and math for different properties
  unitPrecision: 5,
  viewportUnit: "vw",
  fontViewportUnit: "vw", // vmin is more suitable.
  selectorBlackList: [],
  propList: ["*"],
  minPixelValue: 1,
  mediaQuery: false,
  replace: true,
  landscape: false,
  landscapeUnit: "vw",
  landscapeWidth: 568,
};

const ignoreNextComment = "px-to-viewport-ignore-next";
const ignorePrevComment = "px-to-viewport-ignore";

const landscapeWidthCommentRegx = /landscape-width:\s*(\d+)$/;
const viewPortWidthCommentRegx = /viewport-width:\s*(\d+)/;
// 缓存节点的动态注释
const cacheDynamicComment = new Map<ChildNode, Array<Comment | undefined>>();

function postcssPxToViewport(options?: Partial<PostcssPxToViewportOptions>) {
  const opts: PostcssPxToViewportOptions = Object.assign({}, defaults, options);

  checkRegExpOrArray(opts, "exclude");
  checkRegExpOrArray(opts, "include");

  const pxRegex = getUnitRegexp(opts.unitToConvert);
  const satisfyPropList = createPropListMatcher(opts.propList);
  const landscapeRules: Rule[] = [];

  // 查找最近注释，从父节点获取全部子节点，
  // 遍历所有子节点，此节点之前的注释即为最近注释
  // 如果同级没有注释，则从缓存中获取，缓存中为父节点的最近注释
  let nearestLandscapeComment: Comment | undefined = undefined;
  let nearestViewPortComment: Comment | undefined = undefined;
  function findNearestComment(r: Rule) {
    // 如果当前节点没有父节点，则返回空数组
    if (!r.parent) return [];
    // 如果已处理过，直接返回缓存结果
    if (cacheDynamicComment.get(r)) {
      return cacheDynamicComment.get(r);
    }

    // 预处理所有节点的动态注释宽度
    // 如果检测到最新动态宽度注释，则更新注释
    // 如果当前节点不是注释，则绑定释节点
    for (let i = 0; i < r.parent.nodes.length; i++) {
      const node = r.parent.nodes[i];
      if (checkLandscapeWidthComment(node)) {
        nearestLandscapeComment = node;
      } else if (checkViewportWidthComment(node)) {
        nearestViewPortComment = node;
      } else {
        // 如果不是注释节点，则记录当前节点之前最近的动态注释节点
        !checkComment(node) &&
          cacheDynamicComment.set(node, [
            nearestLandscapeComment,
            nearestViewPortComment,
          ]);
      }
    }
    return cacheDynamicComment.get(r);
  }
  // 获取当前rule的动态宽度
  function getDynamicWidth(r: Rule) {
    let dynamicLandscapeWidth, dynamicViewPortWidth;
    const [landscapeComment, viewPortComment] = findNearestComment(r) || [];
    if (landscapeComment) {
      const [_, width] =
        landscapeWidthCommentRegx.exec(landscapeComment.text) || [];
      dynamicLandscapeWidth = Number(width) ?? dynamicLandscapeWidth;
    }

    if (viewPortComment) {
      const [_, width] =
        viewPortWidthCommentRegx.exec(viewPortComment.text) || [];
      dynamicViewPortWidth = Number(width) ?? dynamicViewPortWidth;
    }
    return [dynamicLandscapeWidth, dynamicViewPortWidth];
  }

  return {
    postcssPlugin: "postcss-px-to-viewport",
    Once(root: Root) {
      root.walkRules(function (r) {
        const rule = r as RuleType;
        // Add exclude option to ignore some files like 'node_modules'
        const file = rule.source && rule.source.input.file;

        // 不存在include中 则忽略
        if (opts.include && file && !checkIncludeFile(opts.include, file))
          return;
        // 存在include中 则忽略
        if (opts.exclude && file && checkExcludeFile(opts.exclude, file))
          return;
        // 存在选择器黑名单中则忽略
        if (blacklistedSelector(opts.selectorBlackList, rule.selector)) return;

        // 获取动态注释宽度，如果不存在则使用默认值
        const [
          dynamicLandscapeWidth = opts.landscapeWidth,
          dynamicViewPortWidth = opts.viewportWidth,
        ] = getDynamicWidth(r);

        // 当前rule在横屏模式下的转换
        if (opts.landscape && !rule.parent?.params) {
          const landscapeRule = rule.clone().removeAll();

          rule.walkDecls(function (decl) {
            if (decl.value.indexOf(opts.unitToConvert) === -1) return;
            // 如果不是需要转换的属性则忽略
            if (!satisfyPropList(decl.prop)) return;
            // 转换单位
            landscapeRule.append(
              decl.clone({
                value: decl.value.replace(
                  pxRegex,
                  createPxReplace(
                    opts,
                    opts.landscapeUnit,
                    dynamicLandscapeWidth
                  )
                ),
              })
            );
          });

          if (landscapeRule.nodes.length > 0) {
            landscapeRules.push(landscapeRule);
          }
        }

        // 如果当前rule 如果在媒体查询下并且opts.mediaQuery为false 则忽略
        if (!validateParams(rule.parent?.params, opts.mediaQuery)) return;

        // 当前rule在竖屏模式下的转换
        rule.walkDecls(function (decl, i) {
          // 如果当前rule的值不包含需要转换的单位则忽略
          if (decl.value.indexOf(opts.unitToConvert) === -1) return;
          // 如果不是需要转换的属性则忽略
          if (!satisfyPropList(decl.prop)) return;
          // 同一行的注释在前 则忽略
          const prev = decl.prev();
          // prev declaration is ignore conversion comment at same line
          if (
            prev &&
            prev.type === "comment" &&
            prev.text === ignoreNextComment
          ) {
            // remove comment
            prev.remove();
            return;
          }

          // 同一行的忽略注释在后 移除注释
          const next = decl.next();
          // next declaration is ignore conversion comment at same line
          if (
            next &&
            next.type === "comment" &&
            next.text === ignorePrevComment
          ) {
            // 前面是换行符则告警
            if (next.raws.before && /\n/.test(next.raws.before)) {
              root
                .toResult()
                .warn(
                  "Unexpected comment /* " +
                    ignorePrevComment +
                    " */ must be after declaration at same line.",
                  { node: next }
                );
            } else {
              // remove comment
              next.remove();
              return;
            }
          }

          let unit;
          let size;
          const params = rule.parent?.params;

          // 设置横屏或竖屏的转换单位和尺寸
          if (opts.landscape && params && params.indexOf("landscape") !== -1) {
            unit = opts.landscapeUnit;
            size = dynamicLandscapeWidth;
          } else {
            unit = getUnit(decl.prop, opts);
            size = dynamicViewPortWidth;
          }

          const value = decl.value.replace(
            pxRegex,
            createPxReplace(opts, unit, size)
          );

          // 如果声明存在，则跳过
          if (declarationExists(decl.parent, decl.prop, value)) return;

          // 如果是替换，则直接替换，否则插入到下一行
          if (opts.replace) {
            decl.value = value;
          } else {
            decl.parent?.insertAfter(i, decl.clone({ value: value }));
          }
        });
      });

      // 添加横屏规则
      if (landscapeRules.length > 0) {
        const landscapeRoot = atRule({
          params: "(orientation: landscape)",
          name: "media",
        });
        landscapeRules.forEach(function (rule) {
          landscapeRoot.append(rule);
        });
        root.append(landscapeRoot);
      }

      // 删除注释节点
      cacheDynamicComment.forEach(function (comment) {
        comment.forEach((c) => c?.remove());
      });
      cacheDynamicComment.clear();
    },
  };
}

function checkIncludeFile(
  include: PostcssPxToViewportOptions["include"],
  file: string
) {
  if (isRegExp(include)) return include.test(file);
  if (Array.isArray(include)) return include.some((i) => i.test(file));
}

function checkExcludeFile(
  exclude: PostcssPxToViewportOptions["exclude"],
  file: string
) {
  if (isRegExp(exclude)) return exclude.test(file);
  if (Array.isArray(exclude)) return exclude.some((i) => i.test(file));
}

function getUnit(prop: string, opts: PostcssPxToViewportOptions) {
  return prop.indexOf("font") === -1
    ? opts.viewportUnit
    : opts.fontViewportUnit;
}

function createPxReplace(
  opts: PostcssPxToViewportOptions,
  viewportUnit: string,
  viewportSize: number
) {
  return function (m: any, $1: string) {
    if (!$1) return m;
    const pixels = parseFloat($1);
    if (pixels <= opts.minPixelValue) return m;
    const parsedVal = toFixed(
      (pixels / viewportSize) * 100,
      opts.unitPrecision
    );
    return parsedVal === 0 ? "0" : parsedVal + viewportUnit;
  };
}

function error(decl: Declaration, message: string) {
  throw decl.error(message, { plugin: "postcss-px-to-viewport" });
}

function checkRegExpOrArray(
  options: PostcssPxToViewportOptions,
  optionName: keyof PostcssPxToViewportOptions
) {
  const option = options[optionName];
  if (!option) return;
  if (isRegExp(option)) return;
  if (isArray(option)) {
    const bad = option.some((item) => !isRegExp(item));
    if (!bad) return;
  }
  throw new Error(
    "options." + optionName + " should be RegExp or Array of RegExp."
  );
}

function toFixed(number: number, precision: number) {
  const multiplier = Math.pow(10, precision + 1),
    wholeNumber = Math.floor(number * multiplier);
  return (Math.round(wholeNumber / 10) * 10) / multiplier;
}

function blacklistedSelector(blacklist: string[], selector: string | RegExp) {
  if (!isString(selector)) return;
  return blacklist.some(function (regex) {
    if (isString(regex)) return selector.indexOf(regex) !== -1;
    return selector.match(regex);
  });
}

function declarationExists(
  decls: ContainerWithChildren<ChildNode> | undefined,
  prop: string,
  value: string
) {
  return decls?.some(function (d) {
    const decl: ParentExtendType = d as unknown as ParentExtendType;
    return decl.prop === prop && decl.value === value;
  });
}

function validateParams(params: string | undefined, mediaQuery: boolean) {
  return !params || (params && mediaQuery);
}

function checkViewportWidthComment(node: ChildNode): node is Comment {
  return node.type === "comment" && viewPortWidthCommentRegx.test(node.text);
}

function checkLandscapeWidthComment(node: ChildNode): node is Comment {
  return node.type === "comment" && landscapeWidthCommentRegx.test(node.text);
}

function checkComment(node: ChildNode): node is Comment {
  return node.type === "comment";
}

export default postcssPxToViewport;
